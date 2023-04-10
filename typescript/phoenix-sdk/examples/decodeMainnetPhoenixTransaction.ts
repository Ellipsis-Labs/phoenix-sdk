import { Connection } from "@solana/web3.js";

import * as Phoenix from "../src";

/*
Prints out the Phoenix events for a specific transaction. Notable, the transaction being parsed in this
example is a Solana V0 transaction (rather than a legacy Solana transaction)

Expected output:
[
  {
    "header": {
      "instruction": 0,
      "sequenceNumber": "065a8f",
      "timestamp": "642b3343",
      "slot": "0b1b9714",
      "market": "FZRgpfpvicJ3p23DfmZuvUgcQZBHJsWScTf2N2jK8dy6",
      "signer": "DqyMsuMucBVCqZ81Cw7H4hhs92Dt91oKB1wowKwxV2Fr",
      "totalEvents": 2
    },
    "events": [
      {
        "__kind": "Fill",
        "fields": [
          {
            "index": 0,
            "makerId": "3HBWHuyxWv4uN8U8SeukocrWPfLZJqrtj9DgDHsGo2HR",
            "orderSequenceNumber": "028501",
            "priceInTicks": "01ae82",
            "baseLotsFilled": "05587c",
            "baseLotsRemaining": "01c30c"
          }
        ]
      },
      {
        "__kind": "FillSummary",
        "fields": [
          {
            "index": 1,
            "clientOrderId": "00",
            "totalBaseLotsFilled": "05587c",
            "totalQuoteLotsFilled": "08fd922109",
            "totalFeeInQuoteLots": "3aea11"
          }
        ]
      }
    ]
  }
]
*/
export async function decodeTransaction() {
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  console.log(
    JSON.stringify(
      (
        await Phoenix.getPhoenixEventsFromTransactionSignature(
          connection,
          "5uWatP9Dpsq7BjgUZ83kqhVnRWD3PKZrTH1KYYB7gdu22QXSKP3FBCZ3PcuzecFhxqRnp6aociU5x5RuNAP4F1mh"
        )
      ).instructions,
      null,
      "  "
    )
  );
}

(async function () {
  try {
    await decodeTransaction();
  } catch (err) {
    console.log("Error: ", err);
    process.exit(1);
  }

  process.exit(0);
})();
