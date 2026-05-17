declare module "@ika.xyz/pre-alpha-solana-client/grpc" {
  export interface DKGResult {
    publicKey: Uint8Array;
    publicOutput: Uint8Array;
    attestationData: Uint8Array;
    networkSignature: Uint8Array;
    networkPubkey: Uint8Array;
    dwalletAddr?: Uint8Array;
  }
  export interface IkaClient {
    requestDKG(senderPubkey: Uint8Array): Promise<DKGResult>;
    presign(state: unknown): Promise<unknown>;
    futureSign(state: unknown): Promise<unknown>;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createIkaClient(url: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function defineBcsTypes(): any;
}