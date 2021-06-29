const startCronJob = require('speero-backend/helpers/start.cron.job');
const Helpers = require('speero-backend/helpers');
const Invoice = require('speero-backend/modules/invoices');
const DirectOrder = require('speero-backend/modules/direct.orders');
const Part = require('speero-backend/modules/parts');
const DirectOrderPart = require('speero-backend/modules/direct.order.parts');

const fp = require('./utils/fp-utils');
const { NegativeAmountError } = require('./utils/errors/negative-amount.error');
const { CronJobTimes } = require('./utils/cron-job-utils');

class CreateInvoiceService {
  constructor(directOrderRepo, invoiceRepo, directOrderPartRepo, partRepo, logger = null) {
    this.directOrderRepo = directOrderRepo;
    this.invoiceRepo = invoiceRepo;
    this.directOrderPartRepo = directOrderPartRepo;
    this.partRepo = partRepo;
    this.logger = logger;
  }

  async createInvoice() {
    try {
      const allParts = await this.getAllParts(new Date('2021-04-01'))
      const directOrderPartsGroups = Helpers.groupBy(allParts, 'directOrderId');
      const invcs = [];

      for (const allDirectOrderParts of directOrderPartsGroups) {
        const directOrderId = fp.pipe(fp.nth(0), fp.prop('directOrderId'))(allDirectOrderParts);
        const [directOrder, invoces] = await Promise.all([
          this.directOrderRepo.findOne({ _id: directOrderId })
            .select('partsIds requestPartsIds discountAmount deliveryFees walletPaymentAmount'),
          this.invoiceRepo.find({ directOrderId })
            .select('walletPaymentAmount discountAmount deliveryFees')
        ]);

        const totalPrice = this.getTotalPrice(allDirectOrderParts);
        const { deliveryFees } = directOrder;
        let { walletPaymentAmount, discountAmount } = directOrder;
        let totalAmount = totalPrice;

        if (directOrder.deliveryFees && invoces.length === 0) {
          totalAmount += directOrder.deliveryFees;
        }
        if (walletPaymentAmount) {
          totalAmount -= this.calculateWalletPaymentAmount(walletPaymentAmount, totalAmount, invoces);
        }
        if (discountAmount) {
          totalAmount -= this.calculateDiscount(discountAmount, totalAmount, invoces);
        }
        if (totalAmount < 0) {
          const error = new NegativeAmountError(
            `Could not create invoice for directOrder: ${directOrder._id} with totalAmount: ${totalAmount}.`
          );
          if (this.logger) {
            this.logger.error(error);
          }

          throw error;
        }

        const dps_id = this.getStockAndQoutaParts(allDirectOrderParts).map(fp.prop('_id'));
        const rps_id = this.getRequestParts(allDirectOrderParts).map(fp.prop('_id'));
        const invoice = await this.invoiceRepo.create({
          directOrderId: directOrder._id,
          directOrderPartsIds: dps_id,
          requestPartsIds: rps_id,
          totalPartsAmount: totalPrice,
          totalAmount,
          deliveryFees,
          walletPaymentAmount,
          discountAmount
        });

        await this.onInvoiceCreated(invoice);
        invcs.push(invoice._id);
      }

      return {
        case: 1,
        message: 'invoices created successfully.',
        invoicesIds: invcs
      };
    } catch (err) {
      Helpers.reportError(err);
    }
  }

  async onInvoiceCreated(invoice) {
    const effects = [
      this.updateDirectOrderByCreatedInvoice.bind(this),
      this.updateDirectOrderParts.bind(this),
      this.updatePart.bind(this)
    ];
    await Promise.all(effects.map((effect) => effect(invoice)));
  }

  async getAllParts(fromDate) {
    const [directOrderParts, allParts] = await Promise.all([
      this.directOrderPartRepo.find({
        createdAt: { $gt: fromDate },
        fulfillmentCompletedAt: { $exists: true },
        invoiceId: { $exists: false }
      })
        .select('_id directOrderId partClass priceBeforeDiscount'),
      this.partRepo.find({
        directOrderId: { $exists: true },
        createdAt: { $gt: fromDate },
        partClass: 'requestPart',
        pricedAt: { $exists: true },
        invoiceId: { $exists: false }
      }).select('_id directOrderId partClass premiumPriceBeforeDiscount')
    ]);
    return allParts.concat(directOrderParts)
  }

  getStockAndQoutaParts(allDirectOrderParts) {
    return fp.filter(
      fp.either(fp.propEq('partClass', 'StockPart'), fp.propEq('partClass', 'QuotaPart'))
    )(allDirectOrderParts);
  }

  getRequestParts(allDirectOrderParts) {
    return fp.filter(fp.propEq('partClass', 'requestPart'))(allDirectOrderParts);
  }

  calculateStockAndQoutaPrice(allDirectOrderParts) {
    return this.getStockAndQoutaParts(allDirectOrderParts)
      .reduce((sum, part) => sum + part.priceBeforeDiscount, 0);
  }

  calculateRequestPartsPrice(allDirectOrderParts) {
    return this.getRequestParts(allDirectOrderParts)
      .reduce((sum, part) => sum + part.premiumPriceBeforeDiscount, 0);
  }

  getTotalPrice(allDirectOrderParts) {
    const requestPartsPrice = this.calculateRequestPartsPrice(allDirectOrderParts);
    const qoutaAndStockPrice = this.calculateStockAndQoutaPrice(allDirectOrderParts);
    return Helpers.Numbers.toFixedNumber(requestPartsPrice + qoutaAndStockPrice);
  }

  calculateWalletPaymentAmount(walletPaymentAmount, totalAmount, invoces) {
    const amount = invoces
      .reduce((acc, invoice) => Math.min(0, acc - invoice.walletPaymentAmount), walletPaymentAmount);
    return Math.min(amount, totalAmount);
  }

  alculateDiscount(discountAmount, totalAmount, invoces) {
    const discount = invoces.forEach((acc, invoice) => Math.min(0, acc - invoice.discountAmount), discountAmount);
    return Math.min(discount, totalAmount);
  }

  updateDirectOrderByCreatedInvoice(invoice) {
    const { directOrderId, _id } = invoice;
    return this.directOrderRepo.updateOne({ _id: directOrderId }, {
      $addToSet: { invoicesIds: _id }
    });
  }

  updateDirectOrderParts(invoice) {
    const { directOrderPartsIds, _id: invoiceId } = invoice;
    return Promise.all(
      directOrderPartsIds.map((_id) => this.directOrderPartRepo.updateOne({ _id }, { invoiceId }))
    );
  }

  updatePart(invoice) {
    const { requestPartsIds, _id: invoiceId } = invoice;
    return Promise.all(
      requestPartsIds.map((_id) => this.partRepo.updateOne({ _id }, { invoiceId }))
    );
  }
}

const createInvoiceService = new CreateInvoiceService(
  DirectOrder.Model,
  Invoice.Model,
  DirectOrderPart.Model,
  Part.Model,
  console
);

startCronJob(
  CronJobTimes.EVERY_DAY_AT_12AM,
  createInvoiceService.createInvoice.bind(createInvoiceService),
  true
); // at 00:00 every day

module.exports = createInvoice;