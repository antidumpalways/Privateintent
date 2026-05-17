declare module "@ika.xyz/pre-alpha-solana-client/grpc" {
  export interface DKGResult {
    publicKey: Uint8Array;
    publicOutput: Uint8Array;
    attestationData: Uint8Array;
    networkSignature: Uint8Array;
    networkPubkey: Uint8Array;
  }
  export interface IkaClient {
    requestDKG(senderPubkey: Uint8Array): Promise<DKGResult>;
    presign(): Promise<unknown>;
    futureSign(): Promise<unknown>;
  }
  export function createIkaClient(url: string): IkaClient;
  export function defineBcsTypes(): unknown;
}