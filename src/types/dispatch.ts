export type OrderStatus =
  | 'pending'
  | 'dispatching'
  | 'accepted'
  | 'picked_up'
  | 'done'
  | 'cancelled'
  | 'no_driver';

export type ServiceType =
  | 'city'
  | 'airport'
  | 'chauffeur'
  | 'purchase'
  | 'charter'
  | 'moving';

export interface Order {
  id: string;
  customer_id: string;
  service_type: ServiceType;
  pickup_address: string;
  pickup_geog?: any;
  dropoff_address?: string;
  dropoff_geog?: any;
  passenger_count: number;
  scheduled_time?: Date | null;
  region?: string | null;
  note?: string | null;
  distance_km?: number | null;
  fare?: number | null;
  coupon_id?: string | null;
  status: OrderStatus;
  driver_id?: string | null;
  created_at: Date;
  dispatched_at?: Date | null;
  accepted_at?: Date | null;
  picked_up_at?: Date | null;
  completed_at?: Date | null;
  cancelled_at?: Date | null;
}

export interface DispatchBid {
  id: string;
  order_id: string;
  driver_id: string;
  distance_to_pickup_km?: number | null;
  eta_minutes?: number | null;
  bid_at: Date;
}

export interface DriverCandidate {
  driver_id: string;
  distance_meters: number;
  has_long_ride_priority: boolean;
}

export interface DispatchWinnerResult {
  orderId: string;
  status: 'assigned' | 'no_driver' | 'conflict_or_cancelled';
  winnerDriverId?: string;
  distanceMeters?: number;
  hasPriority?: boolean;
  totalBidsCount: number;
}
