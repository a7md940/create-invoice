const startCronJob = require('speero-backend/helpers/start.cron.job');
const Helpers = require('speero-backend/helpers');
const Invoice = require('speero-backend/modules/invoices');
const DirectOrder = require('speero-backend/modules/direct.orders');
const Part = require('speero-backend/modules/parts');
const DirectOrderPart = require('speero-backend/modules/direct.order.parts');

async function createInvoice () {
  try {
    const dps = await DirectOrderPart.Model.find({ createdAt: { $gt: new Date('2021-04-01') }, fulfillmentCompletedAt: { $exists: true }, invoiceId: { $exists: false } }).select('_id directOrderId partClass priceBeforeDiscount'), ;
    const all_ps = await Part.Model.find({ directOrderId: { $exists: true }, createdAt: { $gt: new Date('2021-04-01') }, partClass: 'requestPart', pricedAt: { $exists: true }, invoiceId: { $exists: false } }).select('_id directOrderId partClass premiumPriceBeforeDiscount');

    const allParts = all_ps.concat(dps);

    const directOrderPartsGroups = Helpers.groupBy(allParts, 'directOrderId');

    const invcs = [];

    for (const allDirectOrderParts of directOrderPartsGroups) {
      const directOrder = await DirectOrder.Model.findOne({ _id: allDirectOrderParts[0].directOrderId }).select('partsIds requestPartsIds discountAmount deliveryFees walletPaymentAmount');
      const invoces = await Invoice.Model.find({ directOrderId: allDirectOrderParts[0].directOrderId }).select('walletPaymentAmount discountAmount deliveryFees');
      const directOrderParts = allDirectOrderParts.filter(directOrderPart => directOrderPart.partClass === 'StockPart' || directOrderPart.partClass === 'QuotaPart');
      const requestParts = allDirectOrderParts.filter(part => part.partClass === 'requestPart');
      const dpsprice = directOrderParts.reduce((sum, part) => sum + part.priceBeforeDiscount, 0);
      const rpsprice = requestParts.reduce((sum, part) => sum + part.premiumPriceBeforeDiscount, 0);
      const dps_id = directOrderParts.map(part => part._id);
      const rps_id = requestParts.map(part => part._id);
      const TotalPrice = Helpers.Numbers.toFixedNumber(rpsprice + dpsprice);
      const { deliveryFees } = directOrder;
      let { walletPaymentAmount, discountAmount } = directOrder;
      let totalAmount = TotalPrice;
      if (directOrder.deliveryFees && invoces.length === 0) {
        totalAmount += directOrder.deliveryFees;
      }

      if (walletPaymentAmount) {
        invoces.forEach(invoice => {
          walletPaymentAmount = Math.min(0, walletPaymentAmount - invoice.walletPaymentAmount);
        });
        walletPaymentAmount = Math.min(walletPaymentAmount, totalAmount);
        totalAmount -= walletPaymentAmount;
      }
      if (discountAmount) {
        invoces.forEach(invoice => {
          discountAmount = Math.min(0, discountAmount - invoice.discountAmount);
        });
        discountAmount = Math.min(discountAmount, totalAmount);
        totalAmount -= discountAmount;
      }

      if (totalAmount < 0) {
        throw Error(`Could not create invoice for directOrder: ${directOrder._id} with totalAmount: ${totalAmount}. `);
      }
      const invoice = await Invoice.Model.create({ directOrderId: directOrder._id, directOrderPartsIds: dps_id, requestPartsIds: rps_id, totalPartsAmount: TotalPrice, totalAmount, deliveryFees, walletPaymentAmount, discountAmount });

      await DirectOrder.Model.updateOne({ _id: directOrder._id }, { $addToSet: { invoicesIds: invoice._id } });
      for (const dp_id of dps_id) {
        await DirectOrderPart.Model.updateOne({ _id: dp_id }, { invoiceId: invoice._id });
      }

      await rps_id.map((rp_id) => {
        return new Promise((resolve, reject) => {
          Part.Model.updateOne({ _id: rp_id }, { invoiceId: invoice._id }).then(function (result) {
            return resolve();
          })
            .catch(() => {
              reject();
            });
        });
      });

      invcs.push(invoice._id);
    }
    return { case: 1, message: 'invoices created successfully.', invoicesIds: invcs };
  } catch (err) {
    Helpers.reportError(err);
  }
}

startCronJob('*/1 * * * *', createInvoice, true); // at 00:00 every day

module.exports = createInvoice;