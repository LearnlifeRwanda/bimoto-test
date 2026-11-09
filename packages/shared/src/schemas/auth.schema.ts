import { z } from 'zod';
import {
  RWANDA_PHONE_REGEX,
  OTP_LENGTH,
  NICKNAME_MIN_LENGTH,
  NICKNAME_MAX_LENGTH,
} from '../constants/config.js';
import { Language } from '../types/user.js';

export const requestOtpSchema = z.object({
  phone: z.string().regex(RWANDA_PHONE_REGEX, 'Invalid Rwandan phone number (+250XXXXXXXXX)'),
});

export const verifyOtpSchema = z.object({
  phone: z.string().regex(RWANDA_PHONE_REGEX, 'Invalid Rwandan phone number (+250XXXXXXXXX)'),
  otp: z.string().length(OTP_LENGTH, `OTP must be ${OTP_LENGTH} digits`),
  nickname: z.string().min(NICKNAME_MIN_LENGTH).max(NICKNAME_MAX_LENGTH).optional(),
  language: z.nativeEnum(Language).optional(),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
