export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  DRIVER = 'DRIVER',
  BOTH = 'BOTH',
  ADMIN = 'ADMIN',
}

export enum Language {
  RW = 'rw',
  EN = 'en',
  FR = 'fr',
}

export enum VehicleType {
  BIKE = 'BIKE',
  MOTO = 'MOTO',
  E_MOTO = 'E_MOTO',
  E_BIKE = 'E_BIKE',
}

export interface User {
  id: string;
  phone: string;
  phoneHash: string;
  nickname: string;
  role: UserRole;
  language: Language;
  idVerified: boolean;
  licenseVerified: boolean;
  // CLEAN-SWEEP G3 — an ARRAY, which is what the server has always sent.
  //
  // This said `string` while the client store said `string[]`, so both
  // shapes were spelled out in the repo and each side believed its own.
  // The server is unambiguous: every writer goes through
  // `emergencyContactsSchema` (a z.array — schemas/user.schema.ts:105),
  // is stored as `encrypt(JSON.stringify(string[]))`
  // (user.service.ts:120), and every reader is `parseEmergencyContacts`
  // (user-phone.ts:78-95), which returns `string[]` on EVERY path —
  // `[]` for null, `[]` for unparseable, `[]` for a non-array, and a
  // string-filtered array otherwise. No writer produces a string at rest
  // and no reader can emit one.
  //
  // The lie cost a real crash: ProfilePage seeded `user?.emergencyContacts
  // || []` into a `string[]` state and called `.map` on it (GAP-CLOSE G2
  // put an Array.isArray belt on it). The belt stays — it costs a line
  // and defends against a cached pre-#192 response — but the type no
  // longer contradicts it.
  emergencyContacts?: string[];
  completedRides: number;
  cancellationCount: number;
  totalRequests: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserPublic {
  id: string;
  nickname: string;
  role: UserRole;
  avgRating?: number;
  totalRides?: number;
  completedRides: number;
  vehicleType?: VehicleType;
  vehicleDescription?: string;
  registrationPlate?: string;
  createdAt: string;
  idVerified: boolean;
  licenseVerified: boolean;
}

export interface DriverProfile {
  id: string;
  userId: string;
  vehicleType: VehicleType;
  registrationPlate?: string;
  vehicleDescription: string;
  avgRating: number;
  totalRides: number;
  isOnline: boolean;
  lastLat?: number;
  lastLng?: number;
  lastLocationAt?: string;
}
