"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  buildCalendarEvent,
  calendarStartOptions,
  type StartOption,
} from "@/lib/calendar";
import type { TaskItem, TaskList } from "@/lib/list-data";
import {
  listCalendarDescription,
  type CalendarContents,
} from "@/lib/list-calendar";

export default function CalendarReminder({
  list,
  items,
  appUrl,
  onClose,
  onBusyChange,
  disabled,
}: {
  list: TaskList;
  items: TaskItem[];
  appUrl: string;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  disabled: boolean;
}) {
  const [title, setTitle] = useState(list.title);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(30);
  const [reminder, setReminder] = useState<number | null>(0);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [contentsMode, setContentsMode] = useState<CalendarContents>("both");
  const [occurrence, setOccurrence] = useState("");
  const [confirmedSignature, setConfirmedSignature] = useState<string | null>(
    null,
  );
  const [status, setStatus] = useState("");
  const [sharing, setSharing] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    form.current
      ?.querySelector<HTMLInputElement>('input[type="date"]')
      ?.focus({ preventScroll: true });
  }, []);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let options: StartOption[] = [];
  let dateError = "";
  if (date && time) {
    try {
      options = calendarStartOptions(date, time);
    } catch (error) {
      dateError =
        error instanceof Error ? error.message : "Check the date and time.";
    }
  }
  const selected =
    options.length === 1
      ? options[0]?.value
      : options.find((option) => option.value === occurrence)?.value;
  const start = selected ? new Date(selected) : null;
  const end =
    start && Number.isInteger(duration) && duration >= 1 && duration <= 1440
      ? new Date(start.getTime() + duration * 60_000)
      : null;
  const formatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const description = listCalendarDescription({
    title: list.title,
    items,
    mode: contentsMode,
    appUrl,
    notes,
  });
  const signature = JSON.stringify([
    title,
    date,
    time,
    duration,
    reminder,
    location,
    description,
    occurrence,
    selected,
    zone,
  ]);
  const confirmed = confirmedSignature === signature;
  function changed() {
    setConfirmedSignature(null);
    setStatus("");
  }
  function eventFile() {
    if (!confirmed || !start || !end)
      throw new Error("Confirm the event date, time, and duration first.");
    if (description.length > 250000)
      throw new Error(
        "This list is too large to copy into one event. Choose App link only.",
      );
    const contents = buildCalendarEvent({
      itemId: `list-${list.id}`,
      title,
      start,
      durationMinutes: duration,
      reminderMinutes: reminder,
      description,
      url: contentsMode === "contents" ? undefined : appUrl,
      location,
    });
    return new File([contents], "list-reminder.ics", {
      type: "text/calendar;charset=utf-8",
    });
  }
  function download(event: FormEvent) {
    event.preventDefault();
    try {
      const file = eventFile();
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus(
        "Calendar file prepared. Open it in your calendar, review the details and alert, then save. Nothing has been scheduled by this app.",
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not prepare the calendar file.",
      );
    }
  }
  async function share() {
    try {
      const file = eventFile();
      if (!navigator.canShare?.({ files: [file] }))
        throw new Error(
          "File sharing is unavailable here. Use Download calendar file instead.",
        );
      setSharing(true);
      onBusyChange(true);
      await navigator.share({ files: [file], title: "Calendar reminder" });
      setStatus(
        "Calendar file shared. Check that your calendar imported it and saved the alert.",
      );
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError"))
        setStatus(
          error instanceof Error
            ? error.message
            : "Could not share the calendar file.",
        );
    } finally {
      setSharing(false);
      onBusyChange(false);
    }
  }
  return (
    <form
      className="panel stack calendar-reminder"
      ref={form}
      onSubmit={download}
      aria-label="Set up list reminder"
    >
      <div className="row spread">
        <h2>Set up list reminder</h2>
        <button
          type="button"
          className="text-button"
          disabled={sharing || disabled}
          onClick={onClose}
        >
          Close setup
        </button>
      </div>
      <p>
        Choose the details, then download or share an event file and save it in
        your calendar. This checkbox opens setup; it does not turn on an alarm.
      </p>
      <label>
        Include in the calendar event
        <select
          value={contentsMode}
          disabled={sharing || disabled}
          onChange={(e) => {
            setContentsMode(e.target.value as CalendarContents);
            changed();
          }}
        >
          <option value="both">App link and all list items</option>
          <option value="link">App link only</option>
          <option value="contents">All list items only</option>
        </select>
      </label>
      <p className="small">
        All {items.length} saved items are included when copying contents, even
        if hidden by search or Show completed. Copied contents are a snapshot.
        The app link opens the current private list and requires its owner to
        sign in.
      </p>
      <details className="calendar-details">
        <summary>Preview what the event includes</summary>
        <pre className="calendar-content-preview">{description}</pre>
      </details>
      <label>
        Event title
        <input
          required
          maxLength={1000}
          value={title}
          disabled={sharing || disabled}
          onChange={(e) => {
            setTitle(e.target.value);
            changed();
          }}
        />
      </label>
      <div className="field-grid">
        <label>
          Date
          <input
            type="date"
            min="1900-01-01"
            max="9999-12-30"
            required
            value={date}
            disabled={sharing || disabled}
            onChange={(e) => {
              setDate(e.target.value);
              setOccurrence("");
              changed();
            }}
          />
        </label>
        <label>
          Time
          <input
            type="time"
            required
            step={60}
            value={time}
            disabled={sharing || disabled}
            onChange={(e) => {
              setTime(e.target.value);
              setOccurrence("");
              changed();
            }}
          />
        </label>
        <label>
          Duration (minutes)
          <input
            type="number"
            required
            min={1}
            max={1440}
            step={1}
            value={duration}
            disabled={sharing || disabled}
            onChange={(e) => {
              setDuration(Number(e.target.value));
              changed();
            }}
          />
        </label>
      </div>
      <p className="small">
        Times use your device’s time zone: {zone}. Change your device time zone
        first if this is not the event’s zone.
      </p>
      {dateError && (
        <p className="notice" role="alert">
          {dateError}
        </p>
      )}
      {options.length > 1 && (
        <label>
          This time occurs twice because the clocks change. Choose which one:
          <select
            required
            value={occurrence}
            disabled={sharing || disabled}
            onChange={(e) => {
              setOccurrence(e.target.value);
              changed();
            }}
          >
            <option value="">Choose a time occurrence</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {time} ({option.offsetLabel})
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Calendar alert
        <select
          value={reminder === null ? "none" : String(reminder)}
          disabled={sharing || disabled}
          onChange={(e) => {
            setReminder(
              e.target.value === "none" ? null : Number(e.target.value),
            );
            changed();
          }}
        >
          <option value="0">At the event time</option>
          <option value="5">5 minutes before</option>
          <option value="15">15 minutes before</option>
          <option value="30">30 minutes before</option>
          <option value="60">1 hour before</option>
          <option value="1440">1 day before</option>
          <option value="none">No alert</option>
        </select>
      </label>
      <details className="calendar-details">
        <summary>Location and notes (optional)</summary>
        <div className="stack">
          <label>
            Location (optional)
            <input
              maxLength={500}
              value={location}
              disabled={sharing || disabled}
              onChange={(e) => {
                setLocation(e.target.value);
                changed();
              }}
            />
          </label>
          <label>
            Notes (optional)
            <textarea
              rows={3}
              maxLength={5000}
              value={notes}
              disabled={sharing || disabled}
              onChange={(e) => {
                setNotes(e.target.value);
                changed();
              }}
            />
          </label>
        </div>
      </details>
      {start && end && (
        <div className="calendar-summary">
          <strong>{title || "Untitled event"}</strong>
          <p>
            {formatter.format(start)} (
            {options.find((option) => option.value === selected)?.offsetLabel})
            → {formatter.format(end)} (
            {
              new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
                .formatToParts(end)
                .find((part) => part.type === "timeZoneName")?.value
            }
            )
          </p>
          <p className="small">
            {duration} minutes ·{" "}
            {reminder === null
              ? "No calendar alert"
              : reminder === 0
                ? "Alert at the event time"
                : `Alert ${reminder} minutes before`}
          </p>
        </div>
      )}
      <label className="inline-check">
        <input
          type="checkbox"
          required
          checked={confirmed}
          disabled={sharing || disabled || !start || !end}
          onChange={(e) =>
            setConfirmedSignature(e.target.checked ? signature : null)
          }
        />{" "}
        I checked the date, time, duration, and alert.
      </label>
      <div className="row">
        <button
          disabled={
            sharing || disabled || !confirmed || !start || !end || !title.trim()
          }
        >
          Download calendar file
        </button>
        {typeof navigator !== "undefined" &&
          typeof navigator.canShare === "function" && (
            <button
              type="button"
              className="secondary"
              disabled={
                sharing ||
                disabled ||
                !confirmed ||
                !start ||
                !end ||
                !title.trim()
              }
              onClick={share}
            >
              {sharing ? "Sharing…" : "Share calendar file"}
            </button>
          )}
      </div>
      <p className="small">
        Your calendar app may handle imported alerts differently. Check the
        alert after saving. Exporting does not complete the task, send
        invitations, or create a phone alarm. Calendar setup is not saved in
        this app; closing it does not remove an event you already imported.
      </p>
      {status && (
        <p className="notice" role="status">
          {status}
        </p>
      )}
    </form>
  );
}
