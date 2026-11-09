declare module 'africastalking' {
  interface ATConfig {
    apiKey: string;
    username: string;
  }

  interface SMSOptions {
    to: string[];
    message: string;
    from?: string;
  }

  interface SMS {
    send(options: SMSOptions): Promise<any>;
  }

  interface AfricasTalking {
    SMS: SMS;
  }

  function africastalking(config: ATConfig): AfricasTalking;
  export default africastalking;
}
