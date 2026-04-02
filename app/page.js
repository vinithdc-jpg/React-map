"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";

// disable SSR
const Map = dynamic(() => import("@/components/Map"), {
  ssr: false,
});

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function formatPlaceTitle(place) {
  const address = place?.address || {};
  const city =
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.county;
  const country = address.country;
  const name =
    place?.name ||
    address.attraction ||
    address.amenity ||
    address.road ||
    place?.display_name?.split(",")?.[0] ||
    "Location";
  const subtitle = [city, country].filter(Boolean).join(", ");
  return { title: name, subtitle };
}

function toMarker(place) {
  const { title, subtitle } = formatPlaceTitle(place);
  const lat = Number(place?.lat);
  const lon = Number(place?.lon);
  return {
    id: crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    lat,
    lon,
    title,
    subtitle,
    raw: place,
  };
}

async function nominatimSearch(q, { signal } = {}) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("dedupe", "1");
  const res = await fetch(url.toString(), {
    signal,
    headers: {
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error("Search failed");
  return await res.json();
}

async function nominatimReverse(lat, lon, { signal } = {}) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  const res = await fetch(url.toString(), {
    signal,
    headers: {
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error("Reverse lookup failed");
  return await res.json();
}

async function osrmRoute(from, to, { signal } = {}) {
  const url = new URL(
    `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}`
  );
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("alternatives", "false");
  const res = await fetch(url.toString(), {
    signal,
    headers: {
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error("Route request failed");
  const data = await res.json();
  if (!data?.routes?.[0]?.geometry?.coordinates?.length) {
    throw new Error("No route found");
  }
  const coords = data.routes[0].geometry.coordinates.map(([lon, lat]) => [
    lat,
    lon,
  ]);
  return {
    coords,
    distanceMeters: data.routes[0].distance,
    durationSeconds: data.routes[0].duration,
  };
}

export default function Home() {
  const [theme, setTheme] = useState("dark"); // "dark" | "light"
  const [flyToKey, setFlyToKey] = useState(1);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [isSuggesting, setIsSuggesting] = useState(false);

  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");

  const [markers, setMarkers] = useState([]);

  const [recent, setRecent] = useState([]); // [{q, ts}]
  const [favorites, setFavorites] = useState([]); // markers

  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [fromSuggestions, setFromSuggestions] = useState([]);
  const [toSuggestions, setToSuggestions] = useState([]);
  const [fromPicked, setFromPicked] = useState(null);
  const [toPicked, setToPicked] = useState(null);

  const [isRouting, setIsRouting] = useState(false);
  const [route, setRoute] = useState(null); // { coords, distanceMeters, durationSeconds, fromId, toId }

  const cacheRef = useRef({});
  const suggestAbort = useRef(null);
  const searchAbort = useRef(null);
  const routeAbort = useRef(null);
  const fromAbort = useRef(null);
  const toAbort = useRef(null);

  const center = useMemo(() => {
    if (selected?.lat && selected?.lon) return [selected.lat, selected.lon];
    if (markers.length) return [markers[markers.length - 1].lat, markers[markers.length - 1].lon];
    return [12.9716, 77.5946]; // Bangalore default
  }, [markers, selected]);

  useEffect(() => {
    // load persisted UI state
    try {
      const savedTheme = localStorage.getItem("mm_theme");
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);

      const savedRecent = JSON.parse(localStorage.getItem("mm_recent") || "[]");
      if (Array.isArray(savedRecent)) setRecent(savedRecent.slice(0, 8));

      const savedFav = JSON.parse(localStorage.getItem("mm_favorites") || "[]");
      if (Array.isArray(savedFav)) setFavorites(savedFav);

      const savedCache = JSON.parse(localStorage.getItem("mm_cache_v1") || "{}");
      if (savedCache && typeof savedCache === "object") cacheRef.current = savedCache;
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(theme);
    try {
      localStorage.setItem("mm_theme", theme);
    } catch {
      // ignore
    }
  }, [theme]);

  function rememberSearch(q) {
    const item = { q, ts: Date.now() };
    setRecent((prev) => {
      const next = [item, ...prev.filter((x) => x?.q !== q)].slice(0, 8);
      try {
        localStorage.setItem("mm_recent", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function saveCache(q, data) {
    const key = q.trim().toLowerCase();
    if (!key) return;
    cacheRef.current[key] = { ts: Date.now(), data };
    try {
      localStorage.setItem("mm_cache_v1", JSON.stringify(cacheRef.current));
    } catch {
      // ignore
    }
  }

  function readCache(q, maxAgeMs = 1000 * 60 * 60 * 24 * 3) {
    const key = q.trim().toLowerCase();
    const hit = cacheRef.current?.[key];
    if (!hit?.ts || !hit?.data) return null;
    if (Date.now() - hit.ts > maxAgeMs) return null;
    return hit.data;
  }

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setIsSuggesting(false);
      return;
    }

    const cached = readCache(`suggest:${q}`, 1000 * 60 * 60);
    if (cached) {
      setSuggestions(cached);
      setIsSuggesting(false);
      return;
    }

    const t = setTimeout(async () => {
      try {
        suggestAbort.current?.abort?.();
        const controller = new AbortController();
        suggestAbort.current = controller;
        setIsSuggesting(true);
        const data = await nominatimSearch(q, { signal: controller.signal });
        setSuggestions(data);
        saveCache(`suggest:${q}`, data);
      } catch {
        // ignore suggestion errors (keep UI calm)
      } finally {
        setIsSuggesting(false);
      }
    }, 250);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    const q = fromQuery.trim();
    if (q.length < 2) {
      setFromSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        fromAbort.current?.abort?.();
        const controller = new AbortController();
        fromAbort.current = controller;
        const data = await nominatimSearch(q, { signal: controller.signal });
        setFromSuggestions(data);
      } catch {
        // ignore
      }
    }, 250);
    return () => clearTimeout(t);
  }, [fromQuery]);

  useEffect(() => {
    const q = toQuery.trim();
    if (q.length < 2) {
      setToSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        toAbort.current?.abort?.();
        const controller = new AbortController();
        toAbort.current = controller;
        const data = await nominatimSearch(q, { signal: controller.signal });
        setToSuggestions(data);
      } catch {
        // ignore
      }
    }, 250);
    return () => clearTimeout(t);
  }, [toQuery]);

  async function runSearch(q) {
    const cleaned = q.trim();
    if (!cleaned) return;
    setError("");
    setIsSearching(true);
    setSelected(null);
    setRoute(null);

    try {
      const cached = readCache(`search:${cleaned}`, 1000 * 60 * 60 * 24 * 7);
      if (cached) {
        setResults(cached);
        rememberSearch(cleaned);
        return;
      }

      searchAbort.current?.abort?.();
      const controller = new AbortController();
      searchAbort.current = controller;
      const data = await nominatimSearch(cleaned, { signal: controller.signal });
      if (!Array.isArray(data) || data.length === 0) {
        setResults([]);
        setError("No locations found. Try a more specific query.");
        return;
      }
      setResults(data);
      saveCache(`search:${cleaned}`, data);
      rememberSearch(cleaned);
    } catch {
      setError("Search failed. Please try again in a moment.");
    } finally {
      setIsSearching(false);
    }
  }

  function selectPlace(place) {
    const m = toMarker(place);
    if (!Number.isFinite(m.lat) || !Number.isFinite(m.lon)) return;
    setSelected(m);
    setMarkers((prev) => [...prev, m]);
    setResults([]);
    setSuggestions([]);
    setFlyToKey((k) => k + 1);
  }

  async function detectMyLocation() {
    setError("");
    setIsSearching(true);
    setRoute(null);
    try {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) reject(new Error("Geolocation not supported"));
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 15000,
        });
      });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const place = await nominatimReverse(lat, lon);
      const marker = toMarker({
        lat,
        lon,
        display_name: place?.display_name ?? "My location",
        address: place?.address,
      });
      marker.title = marker.title === "Location" ? "My location" : marker.title;
      setSelected(marker);
      setMarkers((prev) => [...prev, marker]);
      setFlyToKey((k) => k + 1);
    } catch {
      setError("Couldn’t access your location. Check browser permissions.");
    } finally {
      setIsSearching(false);
    }
  }

  function clearMarkers() {
    setMarkers([]);
    setSelected(null);
    setRoute(null);
    setFromPicked(null);
    setToPicked(null);
  }

  function toggleFavorite(marker) {
    if (!marker) return;
    setFavorites((prev) => {
      const exists = prev.some((f) => f?.lat === marker.lat && f?.lon === marker.lon);
      const next = exists
        ? prev.filter((f) => !(f?.lat === marker.lat && f?.lon === marker.lon))
        : [{ ...marker, id: crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}` }, ...prev];
      try {
        localStorage.setItem("mm_favorites", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  const selectedIsFavorite = useMemo(() => {
    if (!selected) return false;
    return favorites.some((f) => f?.lat === selected.lat && f?.lon === selected.lon);
  }, [favorites, selected]);

  async function buildRoute() {
    if (!fromPicked || !toPicked) {
      setError("Pick both a From and To location to get directions.");
      return;
    }
    setError("");
    setIsRouting(true);
    setRoute(null);
    try {
      routeAbort.current?.abort?.();
      const controller = new AbortController();
      routeAbort.current = controller;

      const fromM = toMarker(fromPicked);
      fromM.title = `From: ${fromM.title}`;
      const toM = toMarker(toPicked);
      toM.title = `To: ${toM.title}`;

      setMarkers((prev) => [...prev, fromM, toM]);
      const r = await osrmRoute(
        { lat: fromM.lat, lon: fromM.lon },
        { lat: toM.lat, lon: toM.lon },
        { signal: controller.signal }
      );
      setRoute({
        coords: r.coords,
        distanceMeters: r.distanceMeters,
        durationSeconds: r.durationSeconds,
        fromId: fromM.id,
        toId: toM.id,
      });
      setSelected(toM);
      setFlyToKey((k) => k + 1);
    } catch {
      setError("Couldn’t build directions for those points.");
    } finally {
      setIsRouting(false);
    }
  }

  const details = useMemo(() => {
    if (!selected?.raw?.address) return null;
    const a = selected.raw.address;
    const city = a.city || a.town || a.village || a.hamlet || a.county || "";
    const country = a.country || "";
    return {
      city,
      country,
      lat: selected.lat,
      lon: selected.lon,
      displayName: selected.raw.display_name,
    };
  }, [selected]);

  const routeMeta = useMemo(() => {
    if (!route?.distanceMeters || !route?.durationSeconds) return null;
    const km = route.distanceMeters / 1000;
    const min = route.durationSeconds / 60;
    return {
      km,
      min,
    };
  }, [route]);

  return (
    <div className="app-gradient relative min-h-[100dvh] w-full overflow-hidden">
      <div className="mx-auto w-full max-w-6xl px-4 py-5">
        <div className="grid items-start gap-4 lg:grid-cols-[440px_1fr]">
          {/* Panel (left on desktop, top on mobile) */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className={cx(
              "glass-panel w-full rounded-2xl p-4 sm:p-5",
              "ring-1 ring-purple-500/15"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-tight">
                  Map Search
                </div>
                <div className="text-xs opacity-80">
                  Autocomplete, multi-markers, directions, favorites.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                  className="rounded-xl border border-purple-500/20 bg-purple-500/10 px-3 py-2 text-xs font-medium transition hover:bg-purple-500/15 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
                  aria-label="Toggle theme"
                >
                  {theme === "dark" ? "Dark" : "Light"}
                </button>
                <button
                  type="button"
                  onClick={detectMyLocation}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
                  aria-label="Use my current location"
                >
                  My location
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="mt-4">
              <div className="relative">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runSearch(query);
                    if (e.key === "Escape") setSuggestions([]);
                  }}
                  placeholder="Search any place (e.g., 'Paris', 'Times Square', 'Tokyo Station')"
                  className={cx(
                    "w-full rounded-2xl border border-purple-500/20 bg-black/20 px-4 py-3 text-sm outline-none transition",
                    "placeholder:text-white/50 focus:border-purple-400/50 focus:bg-black/25 focus:ring-4 focus:ring-purple-500/15",
                    theme === "light" &&
                      "bg-white/60 placeholder:text-slate-500 focus:bg-white/70"
                  )}
                  aria-label="Search location"
                  role="combobox"
                  aria-expanded={suggestions.length > 0}
                />

                <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-75">
                  {isSuggesting ? "Searching…" : null}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => runSearch(query)}
                  disabled={isSearching}
                  className="rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
                >
                  {isSearching ? "Loading…" : "Search"}
                </button>
                <button
                  type="button"
                  onClick={clearMarkers}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
                >
                  Clear markers
                </button>
                {selected ? (
                  <button
                    type="button"
                    onClick={() => toggleFavorite(selected)}
                    className={cx(
                      "rounded-xl border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-purple-400/60",
                      selectedIsFavorite
                        ? "border-purple-400/40 bg-purple-500/15 text-purple-100 hover:bg-purple-500/20"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    )}
                    aria-label="Toggle favorite"
                  >
                    {selectedIsFavorite ? "★ Saved" : "☆ Save"}
                  </button>
                ) : null}
              </div>

              {/* Autocomplete suggestions */}
              <AnimatePresence>
                {suggestions.length > 0 && query.trim().length >= 2 ? (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.16 }}
                    className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/20 backdrop-blur-md"
                    role="listbox"
                    aria-label="Search suggestions"
                  >
                    {suggestions.slice(0, 6).map((s) => (
                      <button
                        key={s.place_id}
                        type="button"
                        onClick={() => selectPlace(s)}
                        className="block w-full px-4 py-3 text-left text-sm transition hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                      >
                        <div className="font-medium">
                          {s.display_name?.split(",")?.[0] ?? "Suggestion"}
                        </div>
                        <div className="mt-0.5 text-xs opacity-75 line-clamp-1">
                          {s.display_name}
                        </div>
                      </button>
                    ))}
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* Results list (multi results) */}
              <AnimatePresence>
                {results.length > 0 ? (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.2 }}
                    className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/20 backdrop-blur-md"
                    role="listbox"
                    aria-label="Search results"
                  >
                    <div className="px-4 py-2 text-xs font-semibold opacity-80">
                      Results ({results.length}) — pick one
                    </div>
                    {results.slice(0, 8).map((r) => (
                      <button
                        key={r.place_id}
                        type="button"
                        onClick={() => selectPlace(r)}
                        className="block w-full border-t border-white/10 px-4 py-3 text-left text-sm transition hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                      >
                        <div className="font-medium">
                          {r.display_name?.split(",")?.[0] ?? "Result"}
                        </div>
                        <div className="mt-0.5 text-xs opacity-75 line-clamp-1">
                          {r.display_name}
                        </div>
                      </button>
                    ))}
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* Error */}
              <AnimatePresence>
                {error ? (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="mt-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm"
                    role="alert"
                  >
                    {error}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            {/* Details card */}
            <AnimatePresence>
              {selected ? (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4"
                >
                  <div className="text-xs font-semibold opacity-80">
                    Location details
                  </div>
                  <div className="mt-2 text-sm font-semibold">
                    {selected.title}
                  </div>
                  {details?.displayName ? (
                    <div className="mt-1 text-xs opacity-80 line-clamp-2">
                      {details.displayName}
                    </div>
                  ) : null}
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="opacity-70">City</div>
                      <div className="mt-1 font-semibold">
                        {details?.city || "—"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="opacity-70">Country</div>
                      <div className="mt-1 font-semibold">
                        {details?.country || "—"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="opacity-70">Latitude</div>
                      <div className="mt-1 font-semibold">
                        {Number(selected.lat).toFixed(5)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="opacity-70">Longitude</div>
                      <div className="mt-1 font-semibold">
                        {Number(selected.lon).toFixed(5)}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* Directions */}
            <div className="mt-4">
              <div className="text-xs font-semibold opacity-80">Directions</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="relative">
                  <input
                    value={fromQuery}
                    onChange={(e) => setFromQuery(e.target.value)}
                    placeholder="From…"
                    className={cx(
                      "w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition",
                      "placeholder:text-white/50 focus:border-purple-400/50 focus:ring-4 focus:ring-purple-500/15",
                      theme === "light" &&
                        "bg-white/60 placeholder:text-slate-500 focus:bg-white/70"
                    )}
                    aria-label="Directions from"
                  />
                  {fromSuggestions.length > 0 && fromQuery.trim().length >= 2 ? (
                    <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-black/25 backdrop-blur-md">
                      {fromSuggestions.slice(0, 4).map((s) => (
                        <button
                          key={s.place_id}
                          type="button"
                          onClick={() => {
                            setFromPicked(s);
                            setFromQuery(s.display_name);
                            setFromSuggestions([]);
                          }}
                          className="block w-full px-4 py-3 text-left text-sm transition hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                        >
                          <div className="font-medium line-clamp-1">
                            {s.display_name}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="relative">
                  <input
                    value={toQuery}
                    onChange={(e) => setToQuery(e.target.value)}
                    placeholder="To…"
                    className={cx(
                      "w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition",
                      "placeholder:text-white/50 focus:border-purple-400/50 focus:ring-4 focus:ring-purple-500/15",
                      theme === "light" &&
                        "bg-white/60 placeholder:text-slate-500 focus:bg-white/70"
                    )}
                    aria-label="Directions to"
                  />
                  {toSuggestions.length > 0 && toQuery.trim().length >= 2 ? (
                    <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-black/25 backdrop-blur-md">
                      {toSuggestions.slice(0, 4).map((s) => (
                        <button
                          key={s.place_id}
                          type="button"
                          onClick={() => {
                            setToPicked(s);
                            setToQuery(s.display_name);
                            setToSuggestions([]);
                          }}
                          className="block w-full px-4 py-3 text-left text-sm transition hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                        >
                          <div className="font-medium line-clamp-1">
                            {s.display_name}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={buildRoute}
                  disabled={isRouting}
                  className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/15 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
                >
                  {isRouting ? "Building…" : "Get directions"}
                </button>
                {routeMeta ? (
                  <div className="text-xs opacity-80">
                    {routeMeta.km.toFixed(1)} km · {Math.round(routeMeta.min)} min
                  </div>
                ) : null}
              </div>
            </div>

            {/* Recent + Favorites */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                <div className="text-xs font-semibold opacity-80">
                  Recent searches
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {recent.length ? (
                    recent.map((r) => (
                      <button
                        key={r.ts}
                        type="button"
                        onClick={() => {
                          setQuery(r.q);
                          runSearch(r.q);
                        }}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
                      >
                        {r.q}
                      </button>
                    ))
                  ) : (
                    <div className="text-xs opacity-70">No recent searches yet.</div>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                <div className="text-xs font-semibold opacity-80">Favorites</div>
                <div className="mt-2 space-y-2">
                  {favorites.length ? (
                    favorites.slice(0, 4).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          setSelected(f);
                          setMarkers((prev) => [...prev, { ...f, id: crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}` }]);
                          setFlyToKey((k) => k + 1);
                        }}
                        className="block w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
                      >
                        <div className="font-semibold line-clamp-1">
                          {f.title ?? "Favorite"}
                        </div>
                        <div className="text-xs opacity-75 line-clamp-1">
                          {f.subtitle || `${Number(f.lat).toFixed(4)}, ${Number(f.lon).toFixed(4)}`}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="text-xs opacity-70">
                      Save a location to see it here.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Map (right on desktop, below on mobile) */}
          <div className="glass-panel overflow-hidden rounded-2xl ring-1 ring-purple-500/15">
            <div className="h-[58vh] min-h-[380px] w-full lg:h-[calc(100dvh-40px)] lg:min-h-[640px]">
              <Map
                center={center}
                markers={markers}
                selectedMarkerId={selected?.id}
                route={route}
                tileTheme={theme}
                flyToKey={flyToKey}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}