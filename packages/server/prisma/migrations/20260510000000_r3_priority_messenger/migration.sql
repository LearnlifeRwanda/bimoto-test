-- R3-PRIORITY — intermediate-urgency PRIORITY_MESSENGER tier.
--
-- Adds a third value to the JourneyType enum, sitting between GOODS
-- and URGENT_MESSENGER on the urgency axis. PRIORITY trips get a
-- 1.15x fare premium (vs URGENT 1.3x) and a half-speed cascade
-- expansion (faster broadcast to wider radius than NORMAL but no
-- full bypass like URGENT). No SLA-window stamping — only
-- URGENT_MESSENGER stamps targetCompletionAt = now + 30min at
-- acceptBid.
ALTER TYPE "JourneyType" ADD VALUE 'PRIORITY_MESSENGER' AFTER 'GOODS';
