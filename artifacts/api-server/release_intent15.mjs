import { releaseSolEscrow } from "./dist/services/solEscrowService.js";

const result = await releaseSolEscrow(15, "9xPwjf2dmafdxhnyZeAaVQpYWxH4Kn1N9XeeLQpnkttu");
console.log(JSON.stringify(result, null, 2));