"use client";
/* eslint-disable @next/next/no-img-element -- A local photo preview must not use a shared image optimizer. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  Camera,
  ListTodo,
  Plus,
  ShoppingBasket,
  Trash2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import CalendarReminder from "./calendar-reminder";
import { preparePhoto } from "@/lib/photo";
import {
  itemsInList,
  nextItemPosition,
  parseListResult,
  type ListKind,
  type ProposedItem,
  type TaskItem,
  type TaskList,
} from "@/lib/list-data";

type DraftItem = ProposedItem & { id: string };
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something failed. Please try again.";
}
export default function Lists({
  session,
  onDirtyChange,
  onBusyChange,
}: {
  session: Session;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [items, setItems] = useState<TaskItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [showCompleted, setShowCompleted] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingList, setEditingList] = useState<TaskList | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ListKind>("todo");
  const [itemText, setItemText] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [importing, setImporting] = useState(false);
  const [photo, setPhoto] = useState("");
  const [review, setReview] = useState<DraftItem[] | null>(null);
  const pendingItemId = useRef<string | null>(null);
  const [calendarItem, setCalendarItem] = useState<TaskItem | null>(null);
  const dirty = Boolean(
    itemText.trim() ||
    editingItemId ||
    calendarItem ||
    photo ||
    review ||
    (formOpen &&
      (title !== (editingList?.title || "") ||
        kind !== (editingList?.kind || "todo"))),
  );
  const activeList = lists.find((list) => list.id === activeId);
  const listItems = activeId ? itemsInList(items, activeId) : [];
  const completed = listItems.filter((item) => item.completed).length;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const books: TaskList[] = [];
        const tasks: TaskItem[] = [];
        for (let offset = 0; active; offset += 200) {
          const { data, error } = await supabase
            .from("task_lists")
            .select("id,title,kind,created_at")
            .eq("user_id", session.user.id)
            .order("created_at", { ascending: false })
            .order("id")
            .range(offset, offset + 199);
          if (error) throw error;
          books.push(...(data || []));
          if (!data || data.length < 200) break;
        }
        for (let offset = 0; active; offset += 200) {
          const { data, error } = await supabase
            .from("task_items")
            .select("id,list_id,text,completed,position,created_at")
            .eq("user_id", session.user.id)
            .order("id")
            .range(offset, offset + 199);
          if (error) throw error;
          tasks.push(...(data || []));
          if (!data || data.length < 200) break;
        }
        if (active) {
          setLists(books);
          setItems(tasks);
          setLoaded(true);
        }
      } catch (error) {
        if (active) {
          setLoaded(false);
          setStatus(`Could not load your lists: ${message(error)}`);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [session.user.id, revision]);
  function resetDrafts() {
    setItemText("");
    setEditingItemId(null);
    setEditText("");
    setFormOpen(false);
    setPhoto("");
    setReview(null);
    setImporting(false);
    setCalendarItem(null);
    pendingItemId.current = null;
  }
  function openList(id: string | null) {
    if (dirty && !confirm("Discard your unsaved list changes?")) return;
    resetDrafts();
    setActiveId(id);
    setQuery("");
    setStatus("");
    setShowCompleted(true);
  }
  function openForm(list: TaskList | null = null) {
    if (dirty && !confirm("Discard your unsaved changes?")) return;
    resetDrafts();
    setEditingList(list);
    setTitle(list?.title || "");
    setKind(list?.kind || "todo");
    setFormOpen(true);
    setStatus("");
  }
  async function saveList(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const record = { title: title.trim(), kind };
      const result = editingList
        ? await supabase
            .from("task_lists")
            .update(record)
            .eq("id", editingList.id)
            .eq("user_id", session.user.id)
            .select("id,title,kind,created_at")
            .single()
        : await supabase
            .from("task_lists")
            .insert({ ...record, user_id: session.user.id })
            .select("id,title,kind,created_at")
            .single();
      if (result.error) throw result.error;
      setLists((old) =>
        editingList
          ? old.map((list) => (list.id === result.data.id ? result.data : list))
          : [result.data, ...old],
      );
      resetDrafts();
      setActiveId(result.data.id);
      setQuery("");
      setStatus(
        editingList
          ? "List updated."
          : "List created. Add an item or photograph your paper list.",
      );
    } catch (error) {
      setStatus(`Could not save list: ${message(error)}`);
    } finally {
      setBusy(false);
    }
  }
  async function addItem(event: FormEvent) {
    event.preventDefault();
    if (!activeList || !itemText.trim()) return;
    setBusy(true);
    try {
      // Reuse the ID after a failed response so a retry cannot duplicate a committed item.
      pendingItemId.current ||= crypto.randomUUID();
      const { error } = await supabase.from("task_items").upsert(
        {
          id: pendingItemId.current,
          user_id: session.user.id,
          list_id: activeList.id,
          text: itemText.trim(),
          completed: false,
          position: nextItemPosition(listItems),
        },
        { onConflict: "id" },
      );
      if (error) throw error;
      setItemText("");
      pendingItemId.current = null;
      setLoaded(false);
      setRevision((value) => value + 1);
      setStatus("Item added.");
    } catch (error) {
      setStatus(`Could not add item: ${message(error)}`);
    } finally {
      setBusy(false);
    }
  }
  async function updateItem(
    item: TaskItem,
    changes: Partial<Pick<TaskItem, "text" | "completed">>,
  ) {
    setBusy(true);
    setStatus("");
    try {
      const { data, error } = await supabase
        .from("task_items")
        .update(changes)
        .eq("id", item.id)
        .eq("user_id", session.user.id)
        .eq("list_id", item.list_id)
        .select("id,list_id,text,completed,position,created_at")
        .single();
      if (error) throw error;
      setItems((old) =>
        old.map((current) => (current.id === item.id ? data : current)),
      );
      if ("text" in changes) {
        setEditingItemId(null);
        setEditText("");
      }
    } catch (error) {
      setStatus(`Could not update item: ${message(error)}`);
    } finally {
      setBusy(false);
    }
  }
  async function deleteItem(item: TaskItem) {
    if (!confirm(`Delete “${item.text}”?`)) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("task_items")
        .delete()
        .eq("id", item.id)
        .eq("user_id", session.user.id)
        .eq("list_id", item.list_id)
        .select("id")
        .single();
      if (error) throw error;
      setItems((old) => old.filter((current) => current.id !== item.id));
      if (calendarItem?.id === item.id) setCalendarItem(null);
      if (editingItemId === item.id) {
        setEditingItemId(null);
        setEditText("");
      }
      setStatus("Item deleted.");
    } catch (error) {
      setStatus(`Could not delete item: ${message(error)}`);
    } finally {
      setBusy(false);
    }
  }
  async function deleteList() {
    if (
      !activeList ||
      !confirm(
        `Delete “${activeList.title}” and all ${listItems.length} items? This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("task_lists")
        .delete()
        .eq("id", activeList.id)
        .eq("user_id", session.user.id)
        .select("id")
        .single();
      if (error) throw error;
      setLists((old) => old.filter((list) => list.id !== activeList.id));
      setItems((old) => old.filter((item) => item.list_id !== activeList.id));
      resetDrafts();
      setActiveId(null);
      setStatus("List deleted.");
    } catch (error) {
      setStatus(`Could not delete list: ${message(error)}`);
    } finally {
      setBusy(false);
    }
  }
  async function clearCompleted() {
    if (
      !activeList ||
      !confirm(`Permanently delete ${completed} completed items?`)
    )
      return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("task_items")
        .delete()
        .eq("user_id", session.user.id)
        .eq("list_id", activeList.id)
        .eq("completed", true)
        .select("id");
      if (error) throw error;
      const removed = new Set(data.map((item) => item.id));
      if (calendarItem && removed.has(calendarItem.id)) setCalendarItem(null);
      setItems((old) => old.filter((item) => !removed.has(item.id)));
      setStatus("Completed items deleted.");
    } catch (error) {
      setStatus(`Could not clear completed items: ${message(error)}`);
    } finally {
      setBusy(false);
    }
  }
  async function choosePhoto(file?: File) {
    if (!file) return;
    if (
      (photo || review) &&
      !confirm("Replace this photo and its proposed items?")
    )
      return;
    setBusy(true);
    setStatus("");
    try {
      setPhoto(await preparePhoto(file));
      setReview(null);
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function readPhoto() {
    if (review && !confirm("Replace the reviewed items with a new reading?"))
      return;
    setBusy(true);
    setStatus("Reading your list…");
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session)
        throw new Error("Sign in again to scan this list.");
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({
          mode: "list",
          imageBase64: photo.split(",")[1],
          mimeType: "image/jpeg",
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not read the list.");
      const proposed = parseListResult(JSON.stringify(result));
      if (!proposed.length)
        throw new Error("No items found. Try a clearer photo.");
      setReview(proposed.map((item) => ({ ...item, id: crypto.randomUUID() })));
      setStatus(
        "Review every item, quantity, and checked box before adding them.",
      );
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function saveReview(event: FormEvent) {
    event.preventDefault();
    if (!activeList || !review?.length) return;
    if (
      review.some((item) => !item.text.trim() || item.text.trim().length > 1000)
    ) {
      setStatus("Each item needs text of up to 1,000 characters.");
      return;
    }
    setBusy(true);
    try {
      const position = nextItemPosition(listItems);
      // One bulk statement is atomic; stable IDs make retries safe.
      const { error } = await supabase.from("task_items").upsert(
        review.map((item, index) => ({
          id: item.id,
          user_id: session.user.id,
          list_id: activeList.id,
          text: item.text.trim(),
          completed: item.completed,
          position: position + index,
        })),
        { onConflict: "id" },
      );
      if (error) throw error;
      const count = review.length;
      setReview(null);
      setPhoto("");
      setImporting(false);
      setLoaded(false);
      setRevision((value) => value + 1);
      setStatus(`${count} reviewed items added.`);
    } catch (error) {
      setStatus(
        `Could not save the reviewed items: ${message(error)} Your review is still here.`,
      );
    } finally {
      setBusy(false);
    }
  }
  const visible = listItems.filter(
    (item) =>
      (showCompleted || !item.completed) &&
      item.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <section className="lists-workspace" aria-label="Your lists">
      <div className="intro">
        <p className="eyebrow">Your private lists</p>
        <h1>{activeList?.title || "A place for things to do."}</h1>
        <p>
          {activeList
            ? activeList.kind === "shopping"
              ? "Your shopping list, ready to check off."
              : "One task at a time."
            : "Shopping, errands, and everything you want to get done."}
        </p>
      </div>
      {status && (
        <p className="notice" role="status">
          {status}
        </p>
      )}
      {activeId && (
        <div className="row spread diary-navigation">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => openList(null)}
          >
            <ArrowLeft size={16} /> All lists
          </button>
          {activeList && (
            <div className="row">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => openForm(activeList)}
              >
                Edit list
              </button>
              <button
                className="text-button danger"
                disabled={busy}
                onClick={deleteList}
              >
                Delete list
              </button>
            </div>
          )}
        </div>
      )}
      {formOpen && (
        <form className="panel stack" onSubmit={saveList}>
          <h2>{editingList ? "Edit list" : "Create a list"}</h2>
          <label>
            List name
            <input
              maxLength={160}
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              placeholder="Weekly shopping"
            />
          </label>
          <label>
            List type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ListKind)}
              disabled={busy}
            >
              <option value="todo">To-do list</option>
              <option value="shopping">Shopping list</option>
            </select>
          </label>
          <div className="row">
            <button disabled={busy || !title.trim()}>
              {busy ? "Saving…" : editingList ? "Save list" : "Create list"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {!loaded ? (
        <button
          className="secondary"
          onClick={() => setRevision((value) => value + 1)}
        >
          Reload lists
        </button>
      ) : !activeId ? (
        <>
          <div className="row spread shelf-heading">
            <p className="small">
              {lists.length} {lists.length === 1 ? "list" : "lists"}
            </p>
            <button disabled={busy} onClick={() => openForm()}>
              <Plus size={18} /> New list
            </button>
          </div>
          {!lists.length ? (
            <div className="empty">
              <ListTodo size={42} />
              <h2>Create your first list.</h2>
              <p>
                Type your items, or photograph a handwritten list and review
                what it contains.
              </p>
              <button disabled={busy} onClick={() => openForm()}>
                <Plus size={18} /> Create a list
              </button>
            </div>
          ) : (
            <div className="cards">
              {lists.map((list) => {
                const tasks = itemsInList(items, list.id);
                const done = tasks.filter((item) => item.completed).length;
                return (
                  <button
                    className="entry-card list-card"
                    key={list.id}
                    disabled={busy}
                    onClick={() => openList(list.id)}
                  >
                    {list.kind === "shopping" ? (
                      <ShoppingBasket size={28} />
                    ) : (
                      <ListTodo size={28} />
                    )}
                    <h2>{list.title}</h2>
                    <p>
                      {tasks.length
                        ? tasks
                            .filter((item) => !item.completed)
                            .slice(0, 3)
                            .map((item) => item.text)
                            .join("\n") || "All done."
                        : "Ready for your first item."}
                    </p>
                    <span className="small">
                      {done} of {tasks.length} complete · Open list →
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : !activeList ? (
        <p className="notice">
          This list is no longer available. Return to All lists.
        </p>
      ) : (
        <>
          {!importing && (
            <>
              <form className="panel add-item-form" onSubmit={addItem}>
                <label>
                  New item
                  <input
                    value={itemText}
                    maxLength={1000}
                    required
                    placeholder={
                      activeList.kind === "shopping"
                        ? "Milk, 2 litres"
                        : "What needs doing?"
                    }
                    onChange={(e) => {
                      setItemText(e.target.value);
                    }}
                    disabled={busy}
                  />
                </label>
                <button disabled={busy || !itemText.trim()}>
                  <Plus size={18} /> Add item
                </button>
              </form>
              <div className="row spread">
                <p className="small">
                  {completed} of {listItems.length} complete
                </p>
                <button
                  className="secondary"
                  disabled={busy || Boolean(editingItemId)}
                  onClick={() => {
                    setImporting(true);
                    setStatus("");
                  }}
                >
                  <Camera size={18} /> Add from photo
                </button>
              </div>
            </>
          )}
          {importing && (
            <section className="panel stack">
              <div className="row spread">
                <h2>Read your paper list</h2>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      (photo || review) &&
                      !confirm(
                        "Discard this photo and the unsaved proposed items?",
                      )
                    )
                      return;
                    setImporting(false);
                    setPhoto("");
                    setReview(null);
                  }}
                >
                  Cancel photo import
                </button>
              </div>
              {photo && (
                <img
                  className="list-photo page-photo"
                  src={photo}
                  alt="Handwritten list to review"
                />
              )}
              <label className="upload-button">
                <Camera size={18} />{" "}
                {photo ? "Choose a different photo" : "Take or choose a photo"}
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  onChange={(e) => {
                    void choosePhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <p className="small">
                Reading sends this photo to Google Gemini and uses the same
                daily scan allowance as diary pages. The app does not store the
                list photo.
              </p>
              {photo && (
                <button disabled={busy} onClick={readPhoto}>
                  {busy
                    ? "Please wait…"
                    : review
                      ? "Read photo again"
                      : "Read list items"}
                </button>
              )}
              {review && (
                <form className="stack" onSubmit={saveReview}>
                  <h2>Review {review.length} proposed items</h2>
                  <p>
                    Nothing has been added yet. Correct the text, remove
                    unwanted items, and confirm any checked boxes. Dates remain
                    in the item text; no reminders are scheduled.
                  </p>
                  {review.map((item, index) => (
                    <div className="review-item" key={item.id}>
                      <label className="task-check">
                        <input
                          type="checkbox"
                          checked={item.completed}
                          disabled={busy}
                          onChange={(e) =>
                            setReview(
                              (old) =>
                                old?.map((current) =>
                                  current.id === item.id
                                    ? {
                                        ...current,
                                        completed: e.target.checked,
                                      }
                                    : current,
                                ) || null,
                            )
                          }
                        />
                        <span className="sr-only">
                          Item {index + 1} is already complete
                        </span>
                      </label>
                      <label>
                        <span className="sr-only">
                          Proposed item {index + 1}
                        </span>
                        <input
                          required
                          maxLength={1000}
                          value={item.text}
                          disabled={busy}
                          onChange={(e) =>
                            setReview(
                              (old) =>
                                old?.map((current) =>
                                  current.id === item.id
                                    ? { ...current, text: e.target.value }
                                    : current,
                                ) || null,
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="text-button danger"
                        disabled={busy}
                        aria-label={`Remove proposed item ${index + 1}`}
                        onClick={() =>
                          setReview(
                            (old) =>
                              old?.filter(
                                (current) => current.id !== item.id,
                              ) || null,
                          )
                        }
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                  <button disabled={busy || !review.length}>
                    {busy
                      ? "Saving…"
                      : `Add ${review.length} reviewed items to this list`}
                  </button>
                </form>
              )}
            </section>
          )}
          {calendarItem && (
            <CalendarReminder
              key={calendarItem.id}
              item={calendarItem}
              listTitle={activeList.title}
              onClose={() => setCalendarItem(null)}
              onBusyChange={setBusy}
              disabled={busy}
            />
          )}
          <div className="list-filters row spread">
            <label className="list-search">
              Search items
              <input
                type="search"
                disabled={Boolean(editingItemId)}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find an item"
              />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={showCompleted}
                disabled={Boolean(editingItemId)}
                onChange={(e) => setShowCompleted(e.target.checked)}
              />{" "}
              Show completed
            </label>
            {completed > 0 && (
              <button
                className="text-button danger"
                disabled={busy || Boolean(editingItemId)}
                onClick={clearCompleted}
              >
                Clear completed
              </button>
            )}
          </div>
          {!visible.length ? (
            <div className="empty">
              <ListTodo size={36} />
              <h2>
                {listItems.length ? "No matching items" : "Your list is ready."}
              </h2>
              <p>
                {listItems.length
                  ? "Change the search or show completed items."
                  : "Add an item above, or take a photo of your paper list."}
              </p>
            </div>
          ) : (
            <ul className="task-items">
              {visible.map((item) => (
                <li
                  key={item.id}
                  className={`task-row ${item.completed ? "task-complete" : ""}`}
                >
                  <label className="task-check">
                    <input
                      type="checkbox"
                      checked={item.completed}
                      disabled={busy}
                      onChange={(e) =>
                        void updateItem(item, { completed: e.target.checked })
                      }
                    />
                    <span className="sr-only">
                      {item.completed ? "Mark incomplete" : "Mark complete"}:{" "}
                      {item.text}
                    </span>
                  </label>
                  {editingItemId === item.id ? (
                    <form
                      className="edit-item-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (editText.trim())
                          void updateItem(item, { text: editText.trim() });
                      }}
                    >
                      <label>
                        <span className="sr-only">Edit item</span>
                        <input
                          required
                          maxLength={1000}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          disabled={busy}
                        />
                      </label>
                      <div className="row">
                        <button disabled={busy || !editText.trim()}>
                          Save
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => {
                            setEditingItemId(null);
                            setEditText("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <span className="task-text">{item.text}</span>
                      <button
                        className="text-button"
                        disabled={busy || Boolean(editingItemId)}
                        onClick={() => {
                          setEditingItemId(item.id);
                          setEditText(item.text);
                        }}
                      >
                        Edit
                      </button>
                    </>
                  )}
                  <label className="inline-check calendar-trigger">
                    <input
                      type="checkbox"
                      checked={calendarItem?.id === item.id}
                      disabled={busy || importing || Boolean(editingItemId)}
                      onChange={(e) => {
                        if (!e.target.checked) {
                          setCalendarItem(null);
                          return;
                        }
                        if (
                          calendarItem &&
                          !confirm("Replace the current calendar draft?")
                        )
                          return;
                        setCalendarItem(item);
                      }}
                    />{" "}
                    Set up calendar reminder
                  </label>
                  <button
                    className="text-button danger"
                    disabled={busy}
                    aria-label={`Delete item: ${item.text}`}
                    onClick={() => void deleteItem(item)}
                  >
                    <Trash2 size={18} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
