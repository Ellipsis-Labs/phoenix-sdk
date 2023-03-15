use borsh::BorshDeserialize;
use phoenix::state::OrderPacket;

pub fn decode_order_packet(bytes: &[u8]) -> anyhow::Result<OrderPacket> {
    let order_packet = match OrderPacket::try_from_slice(bytes) {
        Ok(order_packet) => order_packet,
        Err(_) => {
            let padded_bytes = [bytes, &[0, 0]].concat();
            OrderPacket::try_from_slice(&padded_bytes)?
        }
    };
    Ok(order_packet)
}
