class OrderService {
  constructor(directOrderPartRepo, partRepo) {
    this.directOrderPartRepo = directOrderPartRepo;
    this.partRepo = partRepo;
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

  getDirectOrderById(directOrder_id, attributes) {
    return this.directOrderRepo.findOne({ _id: directOrder_id })
      .select(attributes.join(' '));
  }
}

module.exports = { OrderService };
