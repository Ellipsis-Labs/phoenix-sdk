#[allow(unused_imports)]
use borsh::{BorshDeserialize, BorshSerialize};
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

#[test]
fn test_decode_order_packet() {
    let post_only_op = OrderPacket::new_post_only_default(phoenix::state::Side::Ask, 10000, 10);
    let bytes = post_only_op.try_to_vec().unwrap();
    let decoded_normal = decode_order_packet(&bytes).unwrap();
    let decoded_inferred = decode_order_packet(&bytes[..bytes.len() - 2]).unwrap();
    assert_eq!(post_only_op, decoded_normal);
    assert_eq!(decoded_normal, decoded_inferred);

    let limit_op = OrderPacket::new_limit_order_default(phoenix::state::Side::Ask, 10000, 10);
    let bytes = limit_op.try_to_vec().unwrap();
    let decoded_normal = decode_order_packet(&bytes).unwrap();
    let decoded_inferred = decode_order_packet(&bytes[..bytes.len() - 2]).unwrap();
    assert_eq!(limit_op, decoded_normal);
    assert_eq!(decoded_normal, decoded_inferred);

    let ioc_op = OrderPacket::new_ioc(
        phoenix::state::Side::Ask,
        Some(10000),
        10,
        0,
        0,
        0,
        phoenix::state::SelfTradeBehavior::Abort,
        None,
        0,
        false,
        None,
        None,
    );
    let bytes = ioc_op.try_to_vec().unwrap();
    let decoded_normal = decode_order_packet(&bytes).unwrap();
    let decoded_inferred = decode_order_packet(&bytes[..bytes.len() - 2]).unwrap();
    assert_eq!(ioc_op, decoded_normal);
    assert_eq!(decoded_normal, decoded_inferred);
}
