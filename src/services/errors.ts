/** A request that would duplicate something already open (a payment code for the same
 *  amount, an application for the same phone, programme and year). Routes map it to 409. */
export class DuplicateRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateRequestError";
  }
}
