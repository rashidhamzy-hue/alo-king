export type Vendor = {
  vendor_id: string;
  slug?: string | null;
  name_en: string | null;
  name_ar: string | null;
  category_canonical: string | null;
  village_canonical: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  open_days: string | null;
  open_time: string | null;
  close_time: string | null;
  menu_available: boolean | null;
  is_live: boolean | null;
  is_active: boolean | null;
};

export type OrderItem = {
  item_id?: string;
  name_en: string;
  name_ar?: string;
  unit_price_usd: number;
  quantity: number;
};

export type OrderStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "rejected";

export type Order = {
  id: string;
  short_code: string | null;
  vendor_id: string;
  customer_name: string | null;
  items: OrderItem[] | null;
  subtotal_usd: number | null;
  delivery_fee_usd: number | null;
  total_usd: number | null;
  /** The pound total at the rate locked on the order (the rebuilt orders table has it); legacy rows do not. */
  total_lbp?: number | null;
  status: OrderStatus;
  payment_method: string | null;
  payment_status: string | null;
  delivery_village: string | null;
  building_landmark: string | null;
  notes: string | null;
  customer_lat: number | null;
  customer_lng: number | null;
  driver_id: string | null;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_location_at: string | null;
  prep_minutes: number | null;
  created_at: string;
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  is_expat_gift: boolean | null;
  gift_sender_name: string | null;
  gift_message: string | null;
};

// Never includes customer_phone on screens.
export const ORDER_COLUMNS =
  "id,short_code,vendor_id,customer_name,items,subtotal_usd,delivery_fee_usd,total_usd,status,payment_method,payment_status,delivery_village,building_landmark,notes,customer_lat,customer_lng,driver_id,driver_lat,driver_lng,driver_location_at,prep_minutes,created_at,accepted_at,ready_at,picked_up_at,delivered_at,is_expat_gift,gift_sender_name,gift_message";

export type TrackedOrder = {
  id: string;
  short_code: string | null;
  status: OrderStatus;
  items: OrderItem[] | null;
  subtotal_usd: number | null;
  delivery_fee_usd: number | null;
  total_usd: number | null;
  payment_method: string | null;
  payment_status: string | null;
  delivery_village: string | null;
  is_expat_gift: boolean | null;
  gift_sender_name: string | null;
  gift_message: string | null;
  prep_minutes: number | null;
  created_at: string | null;
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  vendor_name: string | null;
  vendor_lat: number | null;
  vendor_lng: number | null;
  customer_lat: number | null;
  customer_lng: number | null;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_location_at: string | null;
};
