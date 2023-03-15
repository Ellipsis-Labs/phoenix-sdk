import { decodeInstructionData } from "../src/fetchDecodeInstructions";

async function main() {
  // Fetch the idl from github
  const idl = await fetch(
    "https://raw.githubusercontent.com/Ellipsis-Labs/phoenix-v1/master/idl/phoenix_v1.json"
  ).then((res) => res.json());

  // Get the instruction data from a phoenix instruction. Pulled from this tx: 5zYtXpdWFy5c2x5tyeNoPDnCqSdyRMNYq86wvE3xc5fe5WwopC4NVDSuNoqu1wqSvPZL5XTUD21gdLuaqsjTz9ez
  const bs58Data = "3iUqJd5FZ4PsUgsZvmhvWQUhxPAW2B";

  // Example input data
  const inputBuffer = Buffer.from(bs58Data);

  // Result
  console.log(decodeInstructionData(inputBuffer, idl));
}

main().then();
