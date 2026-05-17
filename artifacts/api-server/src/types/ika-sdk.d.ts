declare module "@ika.xyz/pre-alpha-solana-client/grpc" {
  interface DKGResult {
    publicKey: Uint8Array;
    publicOutput: Uint8Array;
    attestationData: Uint8Array;
    networkSignature: Uint8Array;
    networkPubkey: Uint8Array;
    dwalletAddr: Uint8Array;
  }
  interface IkaClient {
    requestDKG(senderPubkey: Uint8Array): Promise<DKGResult>;
    presign(state: unknown): Promise<unknown>;
    futureSign(state: unknown): Promise<unknown>;
  }
  function createIkaClient(url: string): IkaClient;
  namespace createIkaClient {
    function defineBcsTypes(): unknown;
  }
  export = createIkaClient;
}