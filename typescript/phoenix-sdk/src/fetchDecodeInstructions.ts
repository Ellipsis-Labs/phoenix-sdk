import * as bs58 from 'bs58';
import { CancelUpToParams, cancelUpToParamsBeet, depositParamsBeet, MarketStatus, marketStatusBeet, MultipleOrderPacket, multipleOrderPacketBeet, OrderPacket, orderPacketBeet, OrderPacketRecord, ReduceOrderParams, reduceOrderParamsBeet, SeatApprovalStatus, seatApprovalStatusBeet, Side, WithdrawParams, withdrawParamsBeet } from './types';
import { InitializeParams, initializeParamsBeet } from './types/InitializeParams';
import * as beetSolana from '@metaplex-foundation/beet-solana'
import { PublicKey } from '@solana/web3.js'

// Example usage
async function main() {
    // Fetch the idl from github
    const idl: any = await fetch("https://raw.githubusercontent.com/Ellipsis-Labs/phoenix-v1/master/idl/phoenix_v1.json").then(res => res.json());

    // Get the instruction data from a phoenix instruction. Pulled from this tx: 5zYtXpdWFy5c2x5tyeNoPDnCqSdyRMNYq86wvE3xc5fe5WwopC4NVDSuNoqu1wqSvPZL5XTUD21gdLuaqsjTz9ez
    let bs58Data = '17vFw6LXVhPFhWco4rFGJUiZENR4NU4fMnk5tpPgHUaTSAu7VU44Yne62ga5kJUf5eVgvX2gCqEFjtiyN3GaB';

    // Example input data
    let inputBuffer = Buffer.from(bs58Data);

    // Result
    console.log(decodeInstructionData(inputBuffer, idl));

}

main().then(() => console.log("Done"));

// Decode the instruction data and return a json string with the instruction name, accounts, and decoded data
function decodeInstructionData(data: Buffer, idl: any): string {

    let decoded = bs58.decode(data.toString());

    let instructionEnum = decoded[0];

    let matched_idl_instruction = idl.instructions.filter(instruction => {
        return instruction.discriminant.value === instructionEnum
    });

    let instructionName = matched_idl_instruction[0].name;
    let accounts = matched_idl_instruction[0].accounts;
    console.log("Instruction Name: ", matched_idl_instruction[0].name);
    console.log("Accounts: ", accounts);

    let argData = decoded.slice(1, decoded.length);
    let decodedData: any;

    switch (instructionEnum) {
        case 0: decodedData = decodeOrderPacket(argData); break;
        case 1: decodedData = decodeOrderPacket(argData); break;
        case 2: decodedData = decodeOrderPacket(argData); break;
        case 3: decodedData = decodeOrderPacket(argData); break;
        case 4: decodedData = decodeReduceOrder(argData); break;
        case 5: decodedData = decodeOrderPacket(argData); break;
        case 6: decodedData = []; break;
        case 7: decodedData = []; break;
        case 8: decodedData = decodeCancelUpToParams(argData); break;
        case 9: decodedData = decodeCancelUpToParams(argData); break;
        case 10: decodedData = []; break;
        case 11: decodedData = []; break;
        case 12: decodedData = decodeWithdrawParams(argData); break;
        case 13: decodedData = decodeDepositParams(argData); break;
        case 14: decodedData = []; break;
        case 15: decodedData = []; break;
        case 16: decodedData = decodeMultipleOrderPacket(argData); break;
        case 17: decodedData = decodeMultipleOrderPacket(argData); break;
        case 100: decodedData = decodeInitializeParams(argData); break;
        case 101: decodedData = []; break;
        case 102: decodedData = decodeSuccessor(argData); break;
        case 103: decodedData = MarketStatus[decodeMarketStatus(argData)]; break;
        case 104: decodedData = SeatApprovalStatus[decodeSeatApprovalStatus(argData)]; break;
        case 105: decodedData = []; break;
        case 106: decodedData = []; break;
        case 107: decodedData = decodeCancelUpToParams(argData); break;
        case 108: decodedData = []; break;
        case 109: decodedData = []; break;
        default: decodedData = "UNKNOWN INSTRUCTION"

    }

    return JSON.stringify({ instructionName, accounts, decodedData });

}

function decodeOrderPacket(data: Uint8Array): OrderPacket {
    let buffer: Buffer = Buffer.from(data);
    let orderPacket = orderPacketBeet.toFixedFromData(buffer, 0);
    let packetDetails = orderPacket.read(buffer, 0);
    console.log("Order packet: ", packetDetails);
    return packetDetails;
}

function decodeReduceOrder(data: Uint8Array): ReduceOrderParams {
    let buffer: Buffer = Buffer.from(data);
    let reduceOrderParams: ReduceOrderParams = reduceOrderParamsBeet.deserialize(buffer, 0)[0];
    console.log("Reduce order params: ", reduceOrderParams);
    return reduceOrderParams;
}

function decodeCancelUpToParams(data: Uint8Array): CancelUpToParams {
    let buffer: Buffer = Buffer.from(data);
    let cancelUptToParams: CancelUpToParams = cancelUpToParamsBeet.deserialize(buffer, 0)[0];
    console.log("Cancel up to params: ", cancelUptToParams);
    return cancelUptToParams;
}

function decodeWithdrawParams(data: Uint8Array): WithdrawParams {
    let buffer: Buffer = Buffer.from(data);
    let withdrawParams: WithdrawParams = withdrawParamsBeet.deserialize(buffer, 0)[0];
    console.log("Withdraw params: ", withdrawParams);
    return withdrawParams;
}

function decodeDepositParams(data: Uint8Array): any {
    let buffer: Buffer = Buffer.from(data);
    let depositParams: any = depositParamsBeet.deserialize(buffer, 0)[0];
    console.log("Deposit params: ", depositParams);
    return depositParams;
}

function decodeMultipleOrderPacket(data: Uint8Array): MultipleOrderPacket {
    let buffer: Buffer = Buffer.from(data);
    let multipleOrderPackets = multipleOrderPacketBeet.toFixedFromData(buffer, 0);
    let multipleOrders = multipleOrderPackets.read(buffer, 0);
    console.log("Multiple order packets: ", multipleOrders);
    return multipleOrders;
}

function decodeInitializeParams(data: Uint8Array): InitializeParams {
    let buffer: Buffer = Buffer.from(data);
    let initializeParams = initializeParamsBeet.toFixedFromData(buffer, 0);
    let params = initializeParams.read(buffer, 0);
    console.log("Initialize params: ", params)
    return params;
}

function decodeMarketStatus(data: Uint8Array): MarketStatus {
    let buffer: Buffer = Buffer.from(data);
    let marketStatus = marketStatusBeet.read(buffer, 0);
    console.log("Market status: ", MarketStatus[marketStatus]);
    return marketStatus;
}

function decodeSuccessor(data: Uint8Array): any {
    let buffer: Buffer = Buffer.from(data);
    let pubkey = beetSolana.publicKey.read(buffer, 0);
    let result = { successor: pubkey.toBase58() };
    console.log(result);

    return result;
}

function decodeSeatApprovalStatus(data: Uint8Array): SeatApprovalStatus {
    let buffer: Buffer = Buffer.from(data);
    let seatApprovalStatus = seatApprovalStatusBeet.read(buffer, 0);
    console.log("Seat approval status: ", SeatApprovalStatus[seatApprovalStatus]);
    return seatApprovalStatus;
}