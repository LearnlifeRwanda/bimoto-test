import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { DriverNavMap } from '../../components/map/DriverNavMap';
import { ChatEntryButton } from '../../components/chat/ChatEntryButton';
import { EmergencySOS } from '../../components/safety/EmergencySOS';
import { ReportRideCard } from '../../components/report/ReportRideCard';
import { useOwnPosition } from '../../hooks/useOwnPosition';
import { useRideTraceRecorder } from '../../hooks/useRideTraceRecorder';
import { useJourneyStore } from '../../stores/journey.store';
import { useUIStore } from '../../stores/ui.store';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';
import { useAuthStore } from '../../stores/auth.store';
// PARCEL-CATEGORY — same list, same labels, same colours as every other
// screen that names what a parcel contains.
import {
  asParcelCategory,
  parcelCategoryBadgeClass,
  parcelCategoryLabelKey,
} from '../../lib/parcel-category';
import {
  clearGoodsConfirmed,
  hasConfirmedGoods,
  markGoodsConfirmed,
  recoverStep,
  type PickupStep,
} from '../../lib/goods-stage';

// PARCEL-PARITY G2 — which way the motari is actually going, per stage.
//
// A parcel run is two legs, and this screen is where both of them are
// ridden: he photographs the goods at the pickup, checks them against
// the description, then carries them to the drop-off and photographs
// the hand-over. Until now he did all of that with no map at all, while
// the same man carrying a PERSON had one on every screen — ApproachPage
// and ActiveRidePage both mount DriverNavMap. (He does get one riding
// TO the pickup: ApproachPage is shared by both journey types. He lost
// it at IN_PROGRESS, which is the leg with somebody's goods on the
// bike.)
//
// `confirm_goods` sits on the PICKUP side deliberately: he is standing
// at the pickup with the parcel in his hands and has not started the
// delivery leg. handleConfirmGoods is the event that crosses over.
//
// LOOSE-ENDS G4 — and the stage now survives the app dying. The four
// transitions below are UNCHANGED; what is new is the entry state. On
// mount the page reads the stage back from the journey row it already
// fetches (pickupPhotoUrl / deliveryPhotoUrl) plus the one local bit
// the server cannot see, and says so on screen rather than jumping
// silently. See lib/goods-stage.ts for why the ladder is shaped that
// way and why the device is consulted last.
function mapTargetKindFor(step: PickupStep): 'pickup' | 'destination' | null {
  switch (step) {
    case 'pickup_photo':
    case 'confirm_goods':
      return 'pickup';
    case 'delivery_photo':
      return 'destination';
    default:
      // 'done' — nothing left to ride to.
      return null;
  }
}

export const GoodsPickupPage: React.FC = () => {
  const { t } = useTranslation();
  const { id: journeyId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeJourney, setActiveJourney } = useJourneyStore();
  const { showToast } = useUIStore();

  const userId = useAuthStore((s) => s.user?.id);

  const [isLoading, setIsLoading] = useState(true);
  const [step, setStep] = useState<PickupStep>('pickup_photo');
  // Set only when the fetch put him somewhere other than stage one.
  const [resumed, setResumed] = useState(false);
  const [pickupPhotoPreview, setPickupPhotoPreview] = useState<string | null>(null);
  const [pickupPhotoFile, setPickupPhotoFile] = useState<File | null>(null);
  const [deliveryPhotoPreview, setDeliveryPhotoPreview] = useState<string | null>(null);
  const [deliveryPhotoFile, setDeliveryPhotoFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const pickupInputRef = useRef<HTMLInputElement>(null);
  const deliveryInputRef = useRef<HTMLInputElement>(null);

  // PARCEL-PARITY G2 — his own position, watched, exactly as the two
  // passenger-ride driver screens do it. Torn down with the page.
  const ownCoords = useOwnPosition();

  // RIDE-TRACE G2 — the delivery leg leaves a trace too. `step` is this
  // page's own stage truth (lib/goods-stage.ts), and 'delivery_photo'
  // is the one stage where the parcel is ON the bike and moving: the
  // two stages before it are stood at the pickup with the goods still
  // on the ground, and 'done' is the hand-over photographed. The
  // recorder emits nothing — the goods are traced, not followed.
  useRideTraceRecorder(journeyId, step === 'delivery_photo');

  const ownPoint = useMemo(
    () => (ownCoords ? { lat: ownCoords.lat, lng: ownCoords.lng } : null),
    [ownCoords],
  );

  // A parcel journey is an ordinary Journey row: the two legs are the
  // same pickupLat/destinationLat columns a ride uses, already on the
  // response this page fetches. Nothing new is composed and nothing new
  // is asked of the server. A journey missing coordinates renders no
  // map rather than a map of nowhere — the goods panel below still says
  // what is being carried.
  const mapTargetKind = mapTargetKindFor(step);
  const mapTarget = useMemo(() => {
    const j = activeJourney as {
      pickupLat?: number;
      pickupLng?: number;
      destinationLat?: number;
      destinationLng?: number;
    } | null;
    if (mapTargetKind === 'pickup') {
      return typeof j?.pickupLat === 'number' && typeof j?.pickupLng === 'number'
        ? { lat: j.pickupLat, lng: j.pickupLng }
        : null;
    }
    if (mapTargetKind === 'destination') {
      return typeof j?.destinationLat === 'number' && typeof j?.destinationLng === 'number'
        ? { lat: j.destinationLat, lng: j.destinationLng }
        : null;
    }
    return null;
  }, [activeJourney, mapTargetKind]);

  // Fetch journey
  useEffect(() => {
    const fetchJourney = async () => {
      setIsLoading(true);
      try {
        const res = await apiFetch(`/api/journeys/${journeyId}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setActiveJourney(data);

          // LOOSE-ENDS G4 — where he actually left off. The row that
          // just arrived carries the two photo columns this page's own
          // uploads wrote, so the server decides everything it knows
          // and the device only breaks the one tie it cannot.
          const recovered = recoverStep(data, hasConfirmedGoods(journeyId, userId));
          setStep(recovered);
          // Say it, rather than opening on stage three with no
          // explanation. Stage one is not a resume — it is the start.
          setResumed(recovered !== 'pickup_photo');
          if (recovered === 'done') clearGoodsConfirmed(journeyId, userId);
        }
      } catch (err) {
        presentApiError(err);
      } finally {
        setIsLoading(false);
      }
    };

    if (journeyId) fetchJourney();
  }, [journeyId, userId, setActiveJourney, showToast, t]);

  const handlePickupPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPickupPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPickupPhotoPreview(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDeliveryPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setDeliveryPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setDeliveryPhotoPreview(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const uploadPhoto = async (file: File, type: 'pickup-photo' | 'delivery-photo') => {
    const formData = new FormData();
    formData.append('photo', file);

    const res = await apiFetch(`/api/journeys/${journeyId}/upload/${type}`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!res.ok) throw await apiErrorFromResponse(res);

    return res.json();
  };

  const handleUploadPickupPhoto = async () => {
    if (!pickupPhotoFile) {
      showToast(t('goodsPickup.photoRequired'), 'error');
      return;
    }

    setIsUploading(true);
    try {
      await uploadPhoto(pickupPhotoFile, 'pickup-photo');
      showToast(t('goodsPickup.pickupPhotoUploaded'), 'success');
      setResumed(false);
      setStep('confirm_goods');
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmGoods = () => {
    // The one crossover with no network call behind it: he looked in
    // the bag and said yes. Recording that bit is the only reason this
    // page touches device storage at all.
    markGoodsConfirmed(journeyId, userId);
    setResumed(false);
    setStep('delivery_photo');
  };

  const handleUploadDeliveryPhoto = async () => {
    if (!deliveryPhotoFile) {
      showToast(t('goodsPickup.photoRequired'), 'error');
      return;
    }

    setIsUploading(true);
    try {
      await uploadPhoto(deliveryPhotoFile, 'delivery-photo');
      showToast(t('goodsPickup.deliveryPhotoUploaded'), 'success');
      // The run is over and the server holds both photos; the bit has
      // nothing left to decide.
      clearGoodsConfirmed(journeyId, userId);
      setResumed(false);
      setStep('done');
    } catch (err) {
      presentApiError(err);
    } finally {
      setIsUploading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* PARCEL-PARITY G2 — the way to the next stop. Full-bleed, above
          the page's own padded column, so the page's px-4 does not box
          the map in — the same edge-to-edge band ApproachPage and
          ActiveRidePage give it. Offline tiles, the road route when the
          directions proxy answers and the shared dashed connector when
          it cannot all come from the composition; this page knows
          nothing about any of it. */}
      {mapTarget && mapTargetKind && (
        <DriverNavMap
          origin={ownPoint}
          target={mapTarget}
          targetKind={mapTargetKind}
        />
      )}

      <div className="px-4 py-6">
        <div className="w-full max-w-sm mx-auto">
          {/* LOOSE-ENDS G4 — one quiet line, so a motari who reopens
              the app mid-run understands why he is on stage three
              instead of stage one. Never shown on a fresh start. */}
          {resumed && (
            <p
              className="mb-4 text-center text-sm text-gray-500"
              data-testid="goods-resumed-notice"
            >
              {t('goodsPickup.resumed')}
            </p>
          )}

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {(['pickup_photo', 'confirm_goods', 'delivery_photo'] as const).map((s, i) => (
              <React.Fragment key={s}>
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    step === s
                      ? 'bg-[#1B4F72] text-white'
                      : step === 'done' || (['confirm_goods', 'delivery_photo', 'done'].indexOf(step) > ['pickup_photo', 'confirm_goods', 'delivery_photo'].indexOf(s))
                      ? 'bg-[#27AE60] text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {i + 1}
                </div>
                {i < 2 && <div className="w-8 h-0.5 bg-gray-200" />}
              </React.Fragment>
            ))}
          </div>

          {/* Step: Pickup Photo */}
          {step === 'pickup_photo' && (
            <div className="space-y-4">
              <h1 className="text-xl font-bold text-gray-900 text-center">
                {t('goodsPickup.takePickupPhoto')}
              </h1>
              <p className="text-sm text-gray-500 text-center">
                {t('goodsPickup.pickupPhotoDesc')}
              </p>

              {/* Goods info */}
              {activeJourney?.goodsDescription && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-sm font-medium text-gray-700 mb-1">{t('goodsPickup.goodsDesc')}</p>
                  <p className="text-sm text-gray-600">{activeJourney.goodsDescription}</p>
                  {/* VALIDATE-MEND G3 — the real column names. This read
                      was `goodsSize` / `isFragile`, and neither field
                      exists on a journey row: the customer's form writes
                      `goodsSizeCategory` / `goodsFragile`
                      (GoodsRequestPage), the feed card reads those names
                      (ParcelSummary), and db/tables.ts declares them. So
                      the assigned motari saw no size and no fragile
                      warning at the one moment he had the parcel in his
                      hands. journey.store types activeJourney as `any`,
                      which is why no compiler said a word.
                      The case fold matches ParcelSummary: the column is
                      MEDIUM, the catalogue key is goods.size_medium. */}
                  {activeJourney.goodsSizeCategory && (
                    <p className="text-xs text-gray-500 mt-1">
                      {t('goodsPickup.size')}:{' '}
                      {t(`goods.size_${String(activeJourney.goodsSizeCategory).toLowerCase()}`)}
                    </p>
                  )}
                  {/* PARCEL-CATEGORY — what the sender said is in it, in
                      the motari's hands at the moment he picks it up.
                      Same words and same colour as the feed card and the
                      bid screen he came through, so nothing changes name
                      between deciding and carrying. Legacy parcels
                      predate the question and render no badge. */}
                  {asParcelCategory(activeJourney.parcelCategory) && (
                    <p className="mt-1">
                      <span
                        data-testid="goods-pickup-category"
                        data-category={asParcelCategory(activeJourney.parcelCategory)}
                        className={`parcel-category-badge text-xs font-medium px-2 py-0.5 rounded ${parcelCategoryBadgeClass(
                          asParcelCategory(activeJourney.parcelCategory)!,
                        )}`}
                      >
                        {t(
                          parcelCategoryLabelKey(
                            asParcelCategory(activeJourney.parcelCategory)!,
                          ),
                        )}
                      </span>
                    </p>
                  )}
                  {activeJourney.goodsFragile && (
                    <p className="text-xs text-yellow-600 mt-1 font-medium">
                      {t('goodsPickup.fragileWarning')}
                    </p>
                  )}
                </div>
              )}

              {/* Photo capture */}
              <div className="flex flex-col items-center">
                {pickupPhotoPreview ? (
                  <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden mb-4">
                    <img
                      src={pickupPhotoPreview}
                      alt={t('goodsPickup.pickupPhotoAlt')}
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => {
                        setPickupPhotoPreview(null);
                        setPickupPhotoFile(null);
                      }}
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center"
                      aria-label={t('common.remove')}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => pickupInputRef.current?.click()}
                    className="w-full aspect-[4/3] rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 hover:border-[#1B4F72] transition-colors mb-4"
                  >
                    <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-sm text-gray-500">{t('goodsPickup.tapToCapture')}</span>
                  </button>
                )}
                <input
                  ref={pickupInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePickupPhotoChange}
                  className="hidden"
                />
              </div>

              <Button
                fullWidth
                size="lg"
                loading={isUploading}
                onClick={handleUploadPickupPhoto}
                disabled={!pickupPhotoFile}
              >
                {t('goodsPickup.uploadPickupPhoto')}
              </Button>
            </div>
          )}

          {/* Step: Confirm Goods */}
          {step === 'confirm_goods' && (
            <div className="space-y-4 text-center">
              <h1 className="text-xl font-bold text-gray-900">
                {t('goodsPickup.confirmGoods')}
              </h1>
              <p className="text-sm text-gray-500">
                {t('goodsPickup.confirmGoodsDesc')}
              </p>

              {pickupPhotoPreview && (
                <div className="w-full aspect-[4/3] rounded-xl overflow-hidden">
                  <img
                    src={pickupPhotoPreview}
                    alt={t('goodsPickup.pickupPhotoAlt')}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {activeJourney?.goodsDescription && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-left">
                  <p className="text-sm text-gray-600">{activeJourney.goodsDescription}</p>
                </div>
              )}

              <Button
                fullWidth
                size="lg"
                variant="success"
                onClick={handleConfirmGoods}
              >
                {t('goodsPickup.confirmButton')}
              </Button>
            </div>
          )}

          {/* Step: Delivery Photo */}
          {step === 'delivery_photo' && (
            <div className="space-y-4">
              <h1 className="text-xl font-bold text-gray-900 text-center">
                {t('goodsPickup.takeDeliveryPhoto')}
              </h1>
              <p className="text-sm text-gray-500 text-center">
                {t('goodsPickup.deliveryPhotoDesc')}
              </p>

              <div className="flex flex-col items-center">
                {deliveryPhotoPreview ? (
                  <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden mb-4">
                    <img
                      src={deliveryPhotoPreview}
                      alt={t('goodsPickup.deliveryPhotoAlt')}
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => {
                        setDeliveryPhotoPreview(null);
                        setDeliveryPhotoFile(null);
                      }}
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center"
                      aria-label={t('common.remove')}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => deliveryInputRef.current?.click()}
                    className="w-full aspect-[4/3] rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 hover:border-[#1B4F72] transition-colors mb-4"
                  >
                    <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-sm text-gray-500">{t('goodsPickup.tapToCapture')}</span>
                  </button>
                )}
                <input
                  ref={deliveryInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleDeliveryPhotoChange}
                  className="hidden"
                />
              </div>

              <Button
                fullWidth
                size="lg"
                loading={isUploading}
                onClick={handleUploadDeliveryPhoto}
                disabled={!deliveryPhotoFile}
              >
                {t('goodsPickup.uploadDeliveryPhoto')}
              </Button>
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#27AE60]/10 flex items-center justify-center">
                <svg className="w-8 h-8 text-[#27AE60]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-gray-900 mb-2">
                {t('goodsPickup.complete')}
              </h1>
              <p className="text-sm text-gray-500 mb-6">
                {t('goodsPickup.completeDesc')}
              </p>
              <Button
                fullWidth
                onClick={() => navigate('/driver', { replace: true })}
              >
                {t('goodsPickup.backToDashboard')}
              </Button>
              {/* TEAM-ANSWERS G3 — same link, same terms, on the parcel
                  side. A motari who had trouble with a sender has the
                  same route to ops a motari carrying a passenger does. */}
              {journeyId && <ReportRideCard journeyId={journeyId} />}
            </div>
          )}
        </div>
      </div>

      {/* PARCEL-PARITY G3 — the line to the person whose parcel this is.
          The journey room has been there all along (chat is keyed by
          journey id and reads nothing about journey type), and the
          sender can already reach it from MatchedPage and
          InProgressPage; the motari carrying the goods was the one
          participant with no way in. Same component, same sticky bar,
          same existing /journey/:id/chat route as InProgressPage —
          no new machinery and no second message fetch. Not on 'done':
          that screen's one job is to let him leave. */}
      {journeyId && step !== 'done' && (
        <div className="sticky bottom-0 bg-white border-t px-4 py-3">
          <ChatEntryButton journeyId={journeyId} />
        </div>
      )}

      {/* PARCEL-PARITY G3 — the same red button, in the same place his
          passenger's carries and his own carries on every other driver
          screen. EmergencyButton is `fixed bottom-24 right-4 z-50`, so
          this mount changes no layout anywhere.

          Nothing about the endpoint needed changing to make it reach
          here: the guard is participation and not role or journey type,
          so a parcel journey's matched driver passes exactly as a
          ride's does, and the alert resolves "your contacts" by who is
          calling. The component's own copy names Bimoto and 112, never
          a ride, so it needed no goods wording either. */}
      {journeyId && <EmergencySOS journeyId={journeyId} />}
    </div>
  );
};

export default GoodsPickupPage;
