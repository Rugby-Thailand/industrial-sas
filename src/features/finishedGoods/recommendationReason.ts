export function recommendationReason(
  code: string,
  tr: (en: string, th: string) => string,
) {
  const reasons: Record<string, readonly [string, string]> = {
    NO_ACTIVE_LOCATIONS: [
      "No active storage locations are available in this warehouse.",
      "คลังนี้ยังไม่มีจุดจัดเก็บที่เปิดใช้งาน",
    ],
    NO_FIT: [
      "The measured pallet does not fit the available space.",
      "พาเลทที่วัดไม่พอดีกับพื้นที่ว่าง",
    ],
    NO_AVAILABLE_SPACE: [
      "Available space is insufficient for this pallet.",
      "พื้นที่ว่างไม่เพียงพอสำหรับพาเลทนี้",
    ],
    MEASUREMENTS_REQUIRED: [
      "Save complete measurements first.",
      "กรุณาบันทึกขนาดให้ครบก่อน",
    ],
    STORAGE_CONDITION_MISMATCH: [
      "Storage conditions do not match.",
      "เงื่อนไขจัดเก็บไม่ตรงกัน",
    ],
    HEIGHT_EXCEEDED: [
      "The pallet is taller than the available clearance. Check its measured height or choose a taller storage location.",
      "พาเลทสูงเกินพื้นที่ว่าง กรุณาตรวจสอบความสูงที่วัดหรือเลือกจุดจัดเก็บที่สูงกว่า",
    ],
    NO_FREE_FOOTPRINT: [
      "No free position fits the pallet footprint. Check its length and width or make space in a suitable location.",
      "ไม่มีตำแหน่งว่างที่พอดีกับฐานพาเลท กรุณาตรวจสอบความยาวและความกว้าง หรือเตรียมพื้นที่ในจุดจัดเก็บที่เหมาะสม",
    ],
    NO_SUPPORT_SURFACE: [
      "No usable floor or shelf surface is available. Check the storage layout and its active positions.",
      "ไม่มีพื้นหรือชั้นวางที่ใช้ได้ กรุณาตรวจสอบผังและตำแหน่งจัดเก็บที่เปิดใช้งาน",
    ],
    LOCATION_GEOMETRY_UNKNOWN: [
      "A location holds units without measured coordinates, so its free space is unknown. Measure or place those units, or choose another location.",
      "มีจุดจัดเก็บที่มีหน่วยจัดเก็บซึ่งยังไม่มีพิกัด จึงไม่ทราบพื้นที่ว่าง กรุณาระบุตำแหน่งของหน่วยเหล่านั้นหรือเลือกจุดอื่น",
    ],
    STORED_PALLET_REQUIRED: [
      "Store this pallet before moving it.",
      "กรุณาจัดเก็บพาเลทนี้ก่อนย้าย",
    ],
    NOT_FOUND: [
      "This pallet or its product is unavailable in the selected warehouse.",
      "ไม่พบพาเลทหรือสินค้านี้ในคลังที่เลือก",
    ],
    // Pallet tops that cannot support this pallet.
    STACK_PALLET_ONLY: [
      "Only pallet units can be stacked, so pallet tops were not offered.",
      "ซ้อนได้เฉพาะหน่วยที่เป็นพาเลท จึงไม่แสดงตำแหน่งบนพาเลท",
    ],
    PALLET_SUPPORTING_STACK: [
      "This pallet supports another pallet. Move or release the upper pallet before stacking it.",
      "พาเลทนี้รองรับพาเลทอื่นอยู่ กรุณาย้ายหรือปล่อยพาเลทด้านบนก่อนนำไปซ้อน",
    ],
    STACK_CYCLE: [
      "A pallet cannot be stacked on itself or on a pallet it supports.",
      "ไม่สามารถซ้อนพาเลทบนตัวเองหรือบนพาเลทที่ตัวเองรองรับอยู่",
    ],
    STACK_SUPPORT_UNAVAILABLE: [
      "A supporting pallet below is not stored in place, so its top cannot be used.",
      "พาเลทรองรับด้านล่างไม่ได้จัดเก็บอยู่ในตำแหน่ง จึงใช้ด้านบนไม่ได้",
    ],
    STACK_SUPPORT_MOVING: [
      "A pallet that could support this one has an active move. Finish or cancel that move to use its top.",
      "พาเลทที่อาจรองรับได้กำลังถูกย้าย กรุณาย้ายให้เสร็จหรือยกเลิกก่อนใช้ด้านบน",
    ],
    STACK_LIMITS_REQUIRED: [
      "A pallet that could support this one has no stacking limits. Enable stacking and set its maximum levels to use its top.",
      "พาเลทที่อาจรองรับได้ยังไม่มีข้อกำหนดการซ้อน กรุณาอนุญาตให้ซ้อนและกำหนดจำนวนชั้นสูงสุดก่อน",
    ],
    STACK_LEVELS_EXCEEDED: [
      "Stacking on an available pallet would exceed its configured maximum levels.",
      "การซ้อนบนพาเลทที่ว่างจะเกินจำนวนชั้นสูงสุดที่กำหนดไว้",
    ],
    STACK_SUPPORT_OCCUPIED: [
      "Pallet tops in this location are already occupied or reserved.",
      "ด้านบนพาเลทในจุดนี้มีพาเลทวางหรือจองไว้แล้ว",
    ],
  };
  const text = reasons[code];
  return text
    ? tr(...text)
    : tr(
        "No valid position meets the current dimensions and storage constraints.",
        "ไม่มีตำแหน่งที่ตรงกับขนาดและข้อกำหนดการจัดเก็บในขณะนี้",
      );
}
/** One line per distinct explanation; unmapped codes share the fallback. */
export function recommendationReasons(
  codes: readonly string[],
  tr: (en: string, th: string) => string,
) {
  return [...new Set(codes.map((code) => recommendationReason(code, tr)))];
}
