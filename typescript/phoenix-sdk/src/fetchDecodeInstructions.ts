console.log("Start");
import { match } from 'assert';
import * as bs58 from 'bs58';
import { CancelUpToParams, cancelUpToParamsBeet, depositParamsBeet, MultipleOrderPacket, multipleOrderPacketBeet, OrderPacket, orderPacketBeet, OrderPacketRecord, ReduceOrderParams, reduceOrderParamsBeet, Side, WithdrawParams, withdrawParamsBeet } from './types';

// Example usage
async function main() {
    // Fetch the idl from the network https://raw.githubusercontent.com/Ellipsis-Labs/phoenix-v1/master/idl/phoenix_v1.json
    const idl: any = await fetch("https://raw.githubusercontent.com/Ellipsis-Labs/phoenix-v1/master/idl/phoenix_v1.json").then(res => res.json());

    // Get the instruction data from a phoenix instruction
    let bs58Data = 'XTDweLmeW3oQjZ5GKG4aTqCXMPBQoYYatsoWtbhupDb6a';

    let inputBuffer = Buffer.from(bs58Data);

    console.log(decodeInstructionData(inputBuffer, idl));

}

main().then(() => console.log("Done"));

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
        case 100: decodedData = matched_idl_instruction[0].args; break;
        case 101: decodedData = []; break;
        case 102: decodedData = matched_idl_instruction[0].args; break;
        case 103: decodedData = matched_idl_instruction[0].args; break;
        case 104: decodedData = matched_idl_instruction[0].Args; break;
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
    return packetDetails;
}

function decodeReduceOrder(data: Uint8Array): ReduceOrderParams {
    let buffer: Buffer = Buffer.from(data);
    let reduceOrderParams: ReduceOrderParams = reduceOrderParamsBeet.deserialize(buffer, 0)[0];
    console.log("Reduce order params, ", reduceOrderParams);
    return reduceOrderParams;
}

function decodeCancelUpToParams(data: Uint8Array): CancelUpToParams {
    let buffer: Buffer = Buffer.from(data);
    let cancelUptToParams: CancelUpToParams = cancelUpToParamsBeet.deserialize(buffer, 0)[0];
    console.log("Cancel up to params, ", cancelUptToParams);
    return cancelUptToParams;
}

function decodeWithdrawParams(data: Uint8Array): WithdrawParams {
    let buffer: Buffer = Buffer.from(data);
    let withdrawParams: WithdrawParams = withdrawParamsBeet.deserialize(buffer, 0)[0];
    console.log("Withdraw params, ", withdrawParams);
    return withdrawParams;
}

function decodeDepositParams(data: Uint8Array): any {
    let buffer: Buffer = Buffer.from(data);
    let depositParams: any = depositParamsBeet.deserialize(buffer, 0)[0];
    console.log("Deposit params, ", depositParams);
    return depositParams;
}

function decodeMultipleOrderPacket(data: Uint8Array): MultipleOrderPacket {
    let buffer: Buffer = Buffer.from(data);
    let multipleOrderPackets = multipleOrderPacketBeet.toFixedFromData(buffer, 0);
    let multipleOrders = multipleOrderPackets.read(buffer, 0);
    console.log("Multiple order packets, ", multipleOrders);
    return multipleOrders;
}