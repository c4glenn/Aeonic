/** RFC 9457 problem details */
export class HttpError extends Error {
  constructor(
    public status: number,
    public title: string,
    public detail?: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
  }
  toBody() {
    return { type: 'about:blank', title: this.title, status: this.status, detail: this.detail, ...this.extra };
  }
}
export const notFound = (what: string) => new HttpError(404, 'Not Found', `${what} not found`);
