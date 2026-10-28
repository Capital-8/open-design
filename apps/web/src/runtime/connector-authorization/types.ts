export interface ConnectorAuthorization {
  loading(copy: { title: string; body: string }): void;
  info(copy: { title: string; body: string }): void;
  error(message: string): void;
  redirect(url: string): Promise<boolean>;
}
