/**
 * Bookings and racket job cards.
 *
 * The fields behind the booking dialog: who the job is for, what it is, when
 * it is due, what was taken as a deposit, and — for a stringing job — the full
 * intake card (racket, string, tensions, add-ons, charges and the liability
 * acknowledgement). Lifted out of the register screen unchanged, so intake
 * behaves exactly as before.
 */
import { posDayKey } from "../time-zone";
import { useState } from "react";
import type { BookingPaymentTiming, IntakeCharge, PaymentMethod } from "@/core/types/pos-types";

/** A date this many days out, as `YYYY-MM-DD`. */
export const isoDaysFromNow = (days: number) =>
  posDayKey(Date.now() + days * 86_400_000);

export function useBookingIntake() {
  const [bookOpen, setBookOpen] = useState(false);
  const [deposit, setDeposit] = useState("");
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>("cash");
  const [dueDate, setDueDate] = useState(isoDaysFromNow(14));
  const [bookName, setBookName] = useState("");
  const [bookPhone, setBookPhone] = useState("");
  const [bookNote, setBookNote] = useState("");
  // What the booking is for (re-stringing, repair …) and when it gets paid.
  const [serviceId, setServiceId] = useState("");
  const [customService, setCustomService] = useState("");
  const [payTiming, setPayTiming] = useState<BookingPaymentTiming>("deposit");
  /* Racket stringing job card */
  /** Which flow opened the booking dialog: goods booking vs racket job. */
  const [bookMode, setBookMode] = useState<"cart" | "racket">("cart");
  const [racketModel, setRacketModel] = useState("");
  const [stringType, setStringType] = useState("");
  const [tensionMain, setTensionMain] = useState("");
  const [tensionCross, setTensionCross] = useState("");
  const [tensionUnit, setTensionUnit] = useState<"lb" | "kg">("lb");
  const [grommetNotes, setGrommetNotes] = useState("");
  const [jobNotes, setJobNotes] = useState("");
  const [promisedAt, setPromisedAt] = useState("");
  const [stencil, setStencil] = useState(false);
  const [overgrip, setOvergrip] = useState(false);
  /** Job tag / barcode printed on the racket and carried onto the ticket. */
  const [printRacketTag, setPrintRacketTag] = useState(false);
  const [jobTag, setJobTag] = useState("");
  /** Booking hub chooser: racket service vs standard reservation. */
  const [bookingHubOpen, setBookingHubOpen] = useState(false);
  /** Set when the racket dialog is re-opened to edit an existing job. */
  const [editBookingId, setEditBookingId] = useState<string | null>(null);
  const [notifyWhatsApp, setNotifyWhatsApp] = useState(false);
  /** Itemised racket intake charges: labour, string, grip, add-ons. */
  const [intakeCharges, setIntakeCharges] = useState<IntakeCharge[]>([]);
  /** Customer accepted the service & high-tension liability terms at intake. */
  const [liabilityOk, setLiabilityOk] = useState(false);
  /** Customer lookup inside the booking dialog (name or phone). */
  const [bookMemberQuery, setBookMemberQuery] = useState("");
  /** Racket / string sourced from stock, or brought in by the customer. */
  const [racketProductId, setRacketProductId] = useState("");
  const [racketCustomerOwned, setRacketCustomerOwned] = useState(true);
  const [stringProductId, setStringProductId] = useState("");
  const [stringCustomerOwned, setStringCustomerOwned] = useState(false);
  /** Labour is locked to the configured fee until a cashier overrides it. */
  const [labourUnlocked, setLabourUnlocked] = useState(false);
  const [labourReason, setLabourReason] = useState("");

  /** Wipe the job card back to a blank intake. */
  function resetJobCard() {
    setRacketModel("");
    setStringType("");
    setTensionMain("");
    setTensionCross("");
    setTensionUnit("lb");
    setGrommetNotes("");
    setJobNotes("");
    setPromisedAt("");
    setNotifyWhatsApp(false);
    setIntakeCharges([]);
    setStencil(false);
    setOvergrip(false);
    setJobTag("");
    setPrintRacketTag(false);
    setEditBookingId(null);
    setBookMemberQuery("");
    setRacketProductId("");
    setRacketCustomerOwned(true);
    setStringProductId("");
    setStringCustomerOwned(false);
    setLabourUnlocked(false);
    setLabourReason("");
  }

  return {
    bookOpen,
    setBookOpen,
    deposit,
    setDeposit,
    depositMethod,
    setDepositMethod,
    dueDate,
    setDueDate,
    bookName,
    setBookName,
    bookPhone,
    setBookPhone,
    bookNote,
    setBookNote,
    serviceId,
    setServiceId,
    customService,
    setCustomService,
    payTiming,
    setPayTiming,
    bookMode,
    setBookMode,
    racketModel,
    setRacketModel,
    stringType,
    setStringType,
    tensionMain,
    setTensionMain,
    tensionCross,
    setTensionCross,
    tensionUnit,
    setTensionUnit,
    grommetNotes,
    setGrommetNotes,
    jobNotes,
    setJobNotes,
    promisedAt,
    setPromisedAt,
    stencil,
    setStencil,
    overgrip,
    setOvergrip,
    jobTag,
    setJobTag,
    printRacketTag,
    setPrintRacketTag,
    bookingHubOpen,
    setBookingHubOpen,
    editBookingId,
    setEditBookingId,
    notifyWhatsApp,
    setNotifyWhatsApp,
    intakeCharges,
    setIntakeCharges,
    liabilityOk,
    setLiabilityOk,
    bookMemberQuery,
    setBookMemberQuery,
    racketProductId,
    setRacketProductId,
    racketCustomerOwned,
    setRacketCustomerOwned,
    stringProductId,
    setStringProductId,
    stringCustomerOwned,
    setStringCustomerOwned,
    labourUnlocked,
    setLabourUnlocked,
    labourReason,
    setLabourReason,
    resetJobCard,
  };
}
