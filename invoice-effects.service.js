class InvoiceEffects {
  constructor(directOrderRepo, directOrderPartRepo, partRepo) {
    this.directOrderRepo = directOrderRepo;
    this.directOrderPartRepo = directOrderPartRepo;
    this.partRepo = partRepo;
  }
  async onInvoiceCreated(invoice) {
    const effects = [
      this.updateDirectOrderByCreatedInvoice.bind(this),
      this.updateDirectOrderParts.bind(this),
      this.updatePart.bind(this)
    ];
    await Promise.all(effects.map((effect) => effect(invoice)));
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

module.exports = { InvoiceEffects };
