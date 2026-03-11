<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	// ─── State ─────────────────────────────────────────────────────
	let map: any = null;
	let routingControl: any = null;
	let activeTab: 'utbk' | 'campus' = 'utbk';

	let utbkLocations: any[] = [];
	let gates: any[] = [];

	// Campus
	let allBuildings: any[] = [];
	let groupedBuildings: Record<string, any[]> = {};
	let campusSearchQuery = '';
	let filteredBuildings: any[] = [];
	let isLoadingBuildings = false;
	let expandedCategories: Set<string> = new Set();

	// Route
	let selectedLocation: any = null;
	let isRoutingLoading = false;
	let routeInfo: { distance: string; duration: string } | null = null;
	let routeSteps: { text: string; distance: string }[] = [];
	let showSteps = false;

	// Start & Routing settings
	let startPointMode: 'gps' | 'gate' = 'gps';
	let selectedGateId = '';
	let routingProfile: 'foot' | 'driving' = 'driving';
	let routingProvider: 'osrm' | 'ors' | 'mapbox' = 'osrm';

	let userLocation: [number, number] | null = null;
	let locationError = '';
	let mapContainer: HTMLElement;
	let L: any;

	// Category icons
	const CAT_ICON: Record<string, string> = {
		'Lokasi UTBK'      : '📝',
		'Pusat'            : '🏛️',
		'Fak. Pertanian'   : '🌾',
		'Fak. Hukum'       : '⚖️',
		'FEB'              : '💼',
		'FISIP'            : '🏛',
		'Fak. Teknik'      : '⚙️',
		'FMIPA'            : '🔬',
		'FKIP'             : '📚',
		'Fak. Kedokteran'  : '🏥',
		'Pascasarjana'     : '🎓',
		'Sarana Olahraga'  : '⚽',
		'Sarana Umum'      : '🏪',
		'Gerbang'          : '🚪',
		'Lainnya (OSM)'    : '📍',
	};

	const CATEGORY_ORDER = Object.keys(CAT_ICON);

	// ─── Load Data ──────────────────────────────────────────────────
	async function loadInitialData() {
		try {
			const API_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
			const [utbkRes, gatesRes, areaRes, linesRes] = await Promise.all([
				fetch(`${API_BASE}/api/utbk`),
				fetch(`${API_BASE}/api/gates`),
				fetch(`${API_BASE}/api/basemap/area`),
				fetch(`${API_BASE}/api/basemap/lines`)
			]);

			utbkLocations = (await utbkRes.json()).features;
			gates = (await gatesRes.json()).features;
			if (gates.length > 0) selectedGateId = gates[0].properties.fid.toString();

			if (map && L) {
				const areaData = await areaRes.json();
				const linesData = await linesRes.json();

				const worldLatLngs = [[90,-180],[90,180],[-90,180],[-90,-180]];
				let campusLatLngs: any[] = [];
				if (areaData.features.length > 0) {
					const geom = areaData.features[0].geometry;
					const coords = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
					campusLatLngs = coords.map((c: any) => [c[1], c[0]]);
				}

				L.polygon([worldLatLngs, campusLatLngs], {
					color: 'transparent', fillColor: '#0f172a', fillOpacity: 0.88
				}).addTo(map);

				L.geoJSON(areaData, {
					style: { color: '#6366f1', weight: 2.5, fill: false, dashArray: '8,5', opacity: 0.8 }
				}).addTo(map);

				L.geoJSON(linesData, {
					style: (feature: any) => {
						const hw = feature?.properties?.highway || 'unclassified';
						const isPed = ['footway','path','pedestrian','steps','track'].includes(hw);
						return {
							color: isPed ? '#f97316' : '#ef4444',
							weight: isPed ? 2 : 4,
							opacity: 0.9,
							dashArray: isPed ? '4,3' : null
						};
					}
				}).addTo(map);

				if (campusLatLngs.length > 0) {
					map.fitBounds(L.latLngBounds(campusLatLngs), { padding: [30, 30] });
				}
			}
		} catch (e) { console.error(e); }
	}

	async function loadAllBuildings() {
		isLoadingBuildings = true;
		try {
			const API_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
			const res = await fetch(`${API_BASE}/api/buildings`);
			const data = await res.json();
			allBuildings = data.all || [];
			groupedBuildings = data.grouped || {};
			filteredBuildings = allBuildings;
			// Buka 3 kategori pertama by default
			CATEGORY_ORDER.slice(0, 3).forEach(c => {
				if (groupedBuildings[c]) expandedCategories.add(c);
			});
			expandedCategories = new Set(expandedCategories);
		} catch (e) { console.error(e); }
		finally { isLoadingBuildings = false; }
	}

	function filterBuildings() {
		const q = campusSearchQuery.toLowerCase().trim();
		filteredBuildings = q ? allBuildings.filter(b =>
			b.name.toLowerCase().includes(q) || b.category.toLowerCase().includes(q)
		) : allBuildings;
	}

	function debounce(fn: Function, ms = 300) {
		let t: any;
		return (...a: any) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
	}
	const handleSearch = debounce(filterBuildings, 250);

	function getOrderedCategories() {
		const cats = Object.keys(groupedBuildings);
		return [...CATEGORY_ORDER.filter(c => cats.includes(c)), ...cats.filter(c => !CATEGORY_ORDER.includes(c))];
	}

	function toggleCategory(cat: string) {
		if (expandedCategories.has(cat)) expandedCategories.delete(cat);
		else expandedCategories.add(cat);
		expandedCategories = new Set(expandedCategories);
	}

	// ─── GPS ────────────────────────────────────────────────────────
	function getUserLocation() {
		if (!navigator.geolocation) { locationError = 'GPS tidak didukung'; startPointMode = 'gate'; return; }
		navigator.geolocation.getCurrentPosition(
			pos => {
				userLocation = [pos.coords.latitude, pos.coords.longitude];
				if (map && startPointMode === 'gps') { updateStartMarker(); if (selectedLocation) updateRoute(); }
			},
			err => { locationError = 'GPS gagal — pakai Gerbang'; startPointMode = 'gate'; console.warn(err.message); }
		);
	}

	// ─── Markers ────────────────────────────────────────────────────
	let startMarker: any = null;
	let destMarker: any = null;

	function getStartCoords(): [number, number] | null {
		if (startPointMode === 'gps' && userLocation) return userLocation;
		if (startPointMode === 'gate' && selectedGateId) {
			const g = gates.find(g => g.properties.fid.toString() === selectedGateId);
			if (g?.geometry.type === 'Point') return [g.geometry.coordinates[1], g.geometry.coordinates[0]];
		}
		return null;
	}

	function updateStartMarker() {
		if (!map || !L) return;
		if (startMarker) map.removeLayer(startMarker);
		const coords = getStartCoords();
		if (coords) {
			startMarker = L.marker(coords, {
				icon: L.divIcon({
					html: `<div style="width:16px;height:16px;background:#22c55e;border:2.5px solid #fff;border-radius:50%;box-shadow:0 0 0 4px rgba(34,197,94,0.3),0 2px 8px rgba(0,0,0,0.4)"></div>`,
					className: '', iconSize: [16,16], iconAnchor: [8,8]
				}), title: 'Start'
			}).addTo(map).bindPopup(`<b style="color:#22c55e">${startPointMode === 'gps' ? '📍 Lokasi Anda' : '🚪 Gerbang'}</b>`);
		}
	}

	function handleStartChange() { updateStartMarker(); if (selectedLocation) updateRoute(); }

	// ─── Map Init ────────────────────────────────────────────────────
	onMount(async () => {
		if (!browser) return;
		L = (await import('leaflet')).default;
		await import('leaflet-routing-machine');

		map = L.map(mapContainer, { zoomControl: false }).setView([-3.7573, 102.2748], 16);

		// Custom zoom control position
		L.control.zoom({ position: 'bottomright' }).addTo(map);

		const tileUrl = import.meta.env.VITE_MAP_TILE_URL || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
		L.tileLayer(tileUrl, {
			attribution: 'Tiles &copy; Esri', maxZoom: 19
		}).addTo(map);

		delete (L.Icon.Default.prototype as any)._getIconUrl;
		L.Icon.Default.mergeOptions({
			iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
			iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
			shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
		});

		await loadInitialData();
		loadAllBuildings();
		getUserLocation();
	});

	// ─── Routing ────────────────────────────────────────────────────
	const fmt = {
		dist: (m: number) => m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(1)} km`,
		dur:  (s: number) => { const m = Math.floor(s/60); return m < 60 ? `${m} mnt` : `${Math.floor(m/60)} jam ${m%60} mnt`; }
	};

	function updateRoute() {
		if (!map || !L || !selectedLocation) return;
		const start = getStartCoords();
		let target: [number,number] | null = null;

		if (selectedLocation.geometry?.type === 'Point')
			target = [selectedLocation.geometry.coordinates[1], selectedLocation.geometry.coordinates[0]];
		else if (['Polygon','MultiPolygon'].includes(selectedLocation.geometry?.type)) {
			const r = selectedLocation.geometry.type === 'Polygon'
				? selectedLocation.geometry.coordinates[0]
				: selectedLocation.geometry.coordinates[0][0];
			target = [r[0][1], r[0][0]];
		} else if (selectedLocation.center)
			target = selectedLocation.center;

		if (!target) return;

		if (destMarker) map.removeLayer(destMarker);
		destMarker = L.marker(target, {
			icon: L.divIcon({
				html: `<div style="width:18px;height:18px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:2.5px solid #fff;border-radius:5px;transform:rotate(45deg);box-shadow:0 0 0 4px rgba(99,102,241,0.3),0 2px 10px rgba(0,0,0,0.5)"></div>`,
				className: '', iconSize: [18,18], iconAnchor: [9,9]
			}), title: 'Destination'
		}).addTo(map)
			.bindPopup(`<b>${selectedLocation.name || selectedLocation.properties?.name}</b><br><span style="color:#6366f1;font-size:11px">${selectedLocation.category || 'Tujuan'}</span>`)
			.openPopup();

		if (start) {
			if (routingControl) map.removeControl(routingControl);
			isRoutingLoading = true; routeInfo = null; routeSteps = [];

			let routerSpec: any;

			if (routingProvider === 'osrm') {
				const osrmUrl = import.meta.env.VITE_OSRM_URL || 'https://router.project-osrm.org/route/v1';
				routerSpec = (L as any).Routing.osrmv1({
					serviceUrl: osrmUrl,
					profile: routingProfile === 'foot' ? 'foot' : 'car'
				});
			} else if (routingProvider === 'ors') {
				// OpenRouteService public API (requires key usually, using a demo/free tier key if possible or their public demo endpoint)
				// Note: ORS actually officially requires an API key for their public endpoint.
				// We'll use a commonly shared demo key or direct them to add one if it fails, 
				// but for visualization we'll set it up correctly using their matrix.
				const orsUrl = import.meta.env.VITE_ORS_URL || 'https://api.openrouteservice.org/v2/directions';
				const orsKey = import.meta.env.VITE_ORS_API_KEY || '';
				routerSpec = (L as any).Routing.openrouteservice({
					serviceUrl: orsUrl,
					profile: routingProfile === 'foot' ? 'foot-walking' : 'driving-car',
					api_key: orsKey // user token
				});
			} else if (routingProvider === 'mapbox') {
				const mapboxKey = import.meta.env.VITE_MAPBOX_API_KEY || '';
				routerSpec = (L as any).Routing.mapbox(mapboxKey, {
					profile: routingProfile === 'foot' ? 'mapbox/walking' : 'mapbox/driving'
				});
			}

			routingControl = (L as any).Routing.control({
				waypoints: [L.latLng(start[0], start[1]), L.latLng(target[0], target[1])],
				router: routerSpec,
				lineOptions: {
					styles: [{ color: routingProfile === 'foot' ? '#f59e0b' : '#6366f1', opacity: 0.95, weight: 7 }],
					extendToWaypoints: true, missingRouteTolerance: 0
				},
				showAlternatives: false, fitSelectedRoutes: true, show: false, createMarker: () => null
			}).addTo(map);

			routingControl.on('routesfound', (e: any) => {
				isRoutingLoading = false;
				const r = e.routes[0];
				if (r) {
					routeInfo = { distance: fmt.dist(r.summary.totalDistance), duration: fmt.dur(r.summary.totalTime) };
					routeSteps = (r.instructions || []).map((s: any) => ({ text: s.text, distance: s.distance > 0 ? fmt.dist(s.distance) : '' }));
				}
			});
			routingControl.on('routingerror', () => { isRoutingLoading = false; });
		} else {
			map.setView(target, 17);
		}
	}

	function selectLocation(loc: any) { selectedLocation = loc; updateRoute(); }

	function clearRoute() {
		if (routingControl) { map.removeControl(routingControl); routingControl = null; }
		if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
		selectedLocation = null; routeInfo = null; routeSteps = []; showSteps = false;
	}
</script>

<!-- ═════════════════════════════════════════════════════════════ -->
<!--  LAYOUT                                                       -->
<!-- ═════════════════════════════════════════════════════════════ -->
<div class="flex h-full w-full" style="background:#0f172a">

	<!-- ════════════ SIDEBAR ════════════ -->
	<aside class="w-80 shrink-0 flex flex-col z-20 h-full"
		style="background:#0f172a;border-right:1px solid rgba(99,102,241,0.2)">

		<!-- Tab Switcher -->
		<div class="shrink-0 p-3 pb-0">
			<div class="flex p-1 rounded-xl gap-1" style="background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2)">
				<button
					class="flex-1 py-2 text-xs font-semibold rounded-lg transition-all duration-200 {activeTab === 'utbk'
						? 'text-white shadow-lg'
						: 'text-slate-400 hover:text-slate-200'}"
					style={activeTab === 'utbk' ? 'background:linear-gradient(135deg,#4f46e5,#7c3aed)' : ''}
					onclick={() => { activeTab = 'utbk'; clearRoute(); }}
				>
					📝 Lokasi UTBK
				</button>
				<button
					class="flex-1 py-2 text-xs font-semibold rounded-lg transition-all duration-200 {activeTab === 'campus'
						? 'text-white shadow-lg'
						: 'text-slate-400 hover:text-slate-200'}"
					style={activeTab === 'campus' ? 'background:linear-gradient(135deg,#4f46e5,#7c3aed)' : ''}
					onclick={() => { activeTab = 'campus'; clearRoute(); }}
				>
					🏛️ Jelajah Kampus
				</button>
			</div>
		</div>

		<!-- Navigation Config Card -->
		<div class="shrink-0 mx-3 mt-3 p-3 rounded-xl" style="background:rgba(30,27,75,0.5);border:1px solid rgba(99,102,241,0.2)">
			<div class="flex items-center gap-1.5 mb-2.5">
				<div class="w-1 h-4 rounded-full" style="background:linear-gradient(#6366f1,#8b5cf6)"></div>
				<span class="text-[10px] font-bold uppercase tracking-widest" style="color:#6366f1">Konfigurasi Navigasi</span>
			</div>

			<!-- Start Point -->
			<div class="mb-2">
				<label class="text-[10px] text-slate-500 mb-1 block">Titik Awal</label>
				<div class="flex gap-1.5">
					<select
						bind:value={startPointMode}
						onchange={handleStartChange}
						class="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium text-slate-200 outline-none appearance-none cursor-pointer"
						style="background:rgba(15,23,42,0.8);border:1px solid rgba(99,102,241,0.3)"
					>
						<option value="gps">📍 GPS Saya</option>
						<option value="gate">🚪 Gerbang</option>
					</select>
					{#if startPointMode === 'gate'}
						<select
							bind:value={selectedGateId}
							onchange={handleStartChange}
							class="w-28 px-2 py-1.5 rounded-lg text-xs font-medium text-slate-200 outline-none appearance-none cursor-pointer shrink-0"
							style="background:rgba(15,23,42,0.8);border:1px solid rgba(99,102,241,0.3)"
						>
							{#each gates as g}
								<option value={g.properties.fid.toString()}>{g.properties.name}</option>
							{/each}
						</select>
					{/if}
				</div>
				{#if locationError && startPointMode === 'gps'}
					<p class="text-[10px] text-amber-400 mt-1">⚠ {locationError}</p>
				{/if}
			</div>

			<!-- Routing Profile Toggle -->
			<div class="mb-2">
				<label class="text-[10px] text-slate-500 mb-1 block">Mode Rute</label>
				<div class="flex gap-1 p-0.5 rounded-lg" style="background:rgba(15,23,42,0.7)">
					<button
						onclick={() => { routingProfile = 'foot'; if (selectedLocation) updateRoute(); }}
						class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-semibold transition-all {routingProfile === 'foot' ? 'text-amber-900' : 'text-slate-500 hover:text-slate-300'}"
						style={routingProfile === 'foot' ? 'background:linear-gradient(135deg,#f59e0b,#f97316);box-shadow:0 2px 8px rgba(245,158,11,0.4)' : ''}
					>🚶 Jalan Kaki</button>
					<button
						onclick={() => { routingProfile = 'driving'; if (selectedLocation) updateRoute(); }}
						class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-semibold transition-all {routingProfile === 'driving' ? 'text-indigo-900' : 'text-slate-500 hover:text-slate-300'}"
						style={routingProfile === 'driving' ? 'background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 2px 8px rgba(99,102,241,0.4)' : ''}
					>🚗 Kendaraan</button>
				</div>
			</div>

			<!-- Routing Engine Toggle -->
			<div>
				<label class="text-[10px] text-slate-500 mb-1 flex justify-between">
					<span>Mesin Rute</span>
					<span class="text-[8px] text-slate-600">Mempengaruhi akurasi jalan dalam kampus</span>
				</label>
				<div class="flex gap-1 p-0.5 rounded-lg" style="background:rgba(15,23,42,0.7)">
					<button
						onclick={() => { routingProvider = 'osrm'; if (selectedLocation) updateRoute(); }}
						class="flex-1 flex items-center justify-center py-1.5 rounded-md text-[10px] font-semibold transition-all {routingProvider === 'osrm' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}"
						style={routingProvider === 'osrm' ? 'background:rgba(99,102,241,0.4);border:1px solid rgba(99,102,241,0.6)' : ''}
					>OSRM</button>
					<button
						onclick={() => { routingProvider = 'ors'; if (selectedLocation) updateRoute(); }}
						class="flex-1 flex items-center justify-center py-1.5 rounded-md text-[10px] font-semibold transition-all {routingProvider === 'ors' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}"
						style={routingProvider === 'ors' ? 'background:rgba(99,102,241,0.4);border:1px solid rgba(99,102,241,0.6)' : ''}
					>ORS</button>
					<button
						onclick={() => { routingProvider = 'mapbox'; if (selectedLocation) updateRoute(); }}
						class="flex-1 flex items-center justify-center py-1.5 rounded-md text-[10px] font-semibold transition-all {routingProvider === 'mapbox' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}"
						style={routingProvider === 'mapbox' ? 'background:rgba(99,102,241,0.4);border:1px solid rgba(99,102,241,0.6)' : ''}
					>Mapbox</button>
				</div>
			</div>
		</div>

		<!-- Route Result Card -->
		{#if isRoutingLoading}
			<div class="mx-3 mt-2 p-3 rounded-xl flex items-center gap-3 animate-pulse"
				style="background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.3)">
				<svg class="w-5 h-5 shrink-0" style="color:#6366f1;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M21 12a9 9 0 11-6.219-8.56"/>
				</svg>
				<span class="text-xs" style="color:#a5b4fc">Menghitung rute via {routingProvider.toUpperCase()}…</span>
			</div>
		{/if}

		{#if routeInfo}
			<div class="mx-3 mt-2 rounded-xl overflow-hidden" style="border:1px solid rgba(99,102,241,0.3)">
				<div class="p-3 flex items-center justify-between"
					style="background:linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.1))">
					<div class="flex items-center gap-2.5">
						<div class="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0"
							style="background:rgba(15,23,42,0.5)">
							{routingProfile === 'foot' ? '🚶' : '🚗'}
						</div>
						<div>
							<div class="text-base font-bold" style="color:#e2e8f0">{routeInfo.distance}</div>
							<div class="text-[11px]" style="color:#94a3b8">{routeInfo.duration}</div>
						</div>
					</div>
					<div class="flex items-center gap-1">
						{#if routeSteps.length > 0}
							<button
								onclick={() => showSteps = !showSteps}
								class="text-[10px] px-2 py-1 rounded-lg font-medium transition"
								style="background:rgba(99,102,241,0.2);color:#a5b4fc;border:1px solid rgba(99,102,241,0.3)"
							>{showSteps ? '▲' : '▼'} Arah</button>
						{/if}
						<button onclick={clearRoute}
							class="text-[10px] px-2 py-1 rounded-lg font-medium transition ml-1"
							style="background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3)"
						>✕</button>
					</div>
				</div>

				{#if showSteps && routeSteps.length > 0}
					<div class="max-h-48 overflow-y-auto" style="background:rgba(15,23,42,0.6)">
						{#each routeSteps as step, i}
							<div class="flex items-start gap-2 px-3 py-2" style="border-top:1px solid rgba(99,102,241,0.1)">
								<span class="text-[9px] font-bold w-4 shrink-0 mt-0.5 text-center py-0.5 rounded"
									style="background:rgba(99,102,241,0.3);color:#a5b4fc">{i+1}</span>
								<div>
									<div class="text-[11px] leading-snug" style="color:#cbd5e1">{step.text}</div>
									{#if step.distance}<div class="text-[10px] mt-0.5" style="color:#64748b">{step.distance}</div>{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Divider -->
		<div class="mx-3 my-2.5 h-px" style="background:rgba(99,102,241,0.15)"></div>

		<!-- ══ SCROLLABLE CONTENT ══ -->
		<div class="flex-1 overflow-y-auto px-3 pb-4">

			<!-- ═══ TAB: UTBK ═══ -->
			{#if activeTab === 'utbk'}
				<div class="animate-fade-up">
					<p class="text-[11px] mb-3" style="color:#64748b">
						Pilih gedung UTBK untuk memulai navigasi dari titik awal Anda.
					</p>
					{#if utbkLocations.length === 0}
						<div class="space-y-2">
							{#each [1,2,3,4,5,6] as _}
								<div class="skeleton h-14 w-full rounded-xl"></div>
							{/each}
						</div>
					{:else}
						<div class="space-y-2">
							{#each utbkLocations as loc, i}
								<button
									onclick={() => selectLocation(loc)}
									class="w-full text-left rounded-xl transition-all duration-200 overflow-hidden animate-fade-up"
									style="animation-delay:{i*50}ms;border:1px solid {selectedLocation === loc ? 'rgba(99,102,241,0.7)' : 'rgba(99,102,241,0.15)' };background:{selectedLocation === loc ? 'linear-gradient(135deg,rgba(99,102,241,0.25),rgba(139,92,246,0.15))' : 'rgba(30,27,75,0.3)'}"
								>
									<div class="flex items-center gap-3 px-4 py-3">
										<div class="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-base"
											style="background:linear-gradient(135deg,rgba(99,102,241,0.3),rgba(139,92,246,0.2));border:1px solid rgba(99,102,241,0.3)">
											🏫
										</div>
										<div class="flex-1 min-w-0">
											<div class="font-semibold text-sm leading-tight truncate" style="color:#e2e8f0">
												{loc.properties.name || 'Gedung UTBK'}
											</div>
											<div class="text-[10px] mt-0.5 flex items-center gap-1" style="color:#6366f1">
												<span>📝</span><span>Lokasi Resmi UTBK</span>
											</div>
										</div>
										{#if selectedLocation === loc}
											<div class="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
												style="background:#6366f1">
												<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
													<polyline points="20 6 9 17 4 12"/>
												</svg>
											</div>
										{/if}
									</div>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- ═══ TAB: JELAJAH KAMPUS ═══ -->
			{#if activeTab === 'campus'}
				<div class="animate-fade-up">

					<!-- Search -->
					<div class="relative mb-3">
						<div class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
								<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
							</svg>
						</div>
						<input
							type="text"
							bind:value={campusSearchQuery}
							oninput={handleSearch}
							placeholder="Cari gedung, fakultas…"
							class="w-full pl-9 pr-8 py-2.5 rounded-xl text-sm outline-none transition-all"
							style="background:rgba(15,23,42,0.7);border:1px solid rgba(99,102,241,0.3);color:#e2e8f0;placeholder-color:#475569"
						/>
						{#if campusSearchQuery}
							<button
								onclick={() => { campusSearchQuery = ''; filteredBuildings = allBuildings; }}
								class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
							>✕</button>
						{/if}
					</div>

					<!-- Count Badge -->
					{#if allBuildings.length > 0}
						<div class="flex items-center gap-2 mb-3">
							<div class="px-2 py-0.5 rounded-full text-[10px] font-bold"
								style="background:rgba(99,102,241,0.2);color:#a5b4fc;border:1px solid rgba(99,102,241,0.3)">
								{campusSearchQuery ? filteredBuildings.length : allBuildings.length} gedung
							</div>
							{#if campusSearchQuery}
								<span class="text-[10px]" style="color:#64748b">hasil untuk "{campusSearchQuery}"</span>
							{/if}
						</div>
					{/if}

					<!-- Loading Skeleton -->
					{#if isLoadingBuildings}
						<div class="space-y-1.5">
							{#each [1,2,3,4,5] as _}
								<div class="skeleton h-10 w-full rounded-lg"></div>
							{/each}
						</div>

					<!-- Search Results (flat) -->
					{:else if campusSearchQuery.trim()}
						{#if filteredBuildings.length === 0}
							<div class="text-center py-10">
								<div class="text-4xl mb-2">🔍</div>
								<p class="text-sm" style="color:#475569">Tidak ada hasil untuk</p>
								<p class="text-sm font-semibold mt-1" style="color:#6366f1">"{campusSearchQuery}"</p>
							</div>
						{:else}
							<div class="space-y-1">
								{#each filteredBuildings as loc}
									<button
										onclick={() => selectLocation(loc)}
										class="w-full text-left px-3 py-2.5 rounded-lg transition-all"
										style="background:{selectedLocation === loc ? 'rgba(99,102,241,0.2)' : 'rgba(30,27,75,0.3)'};border:1px solid {selectedLocation === loc ? 'rgba(99,102,241,0.5)' : 'rgba(99,102,241,0.1)'}"
									>
										<div class="flex items-center gap-2">
											<span class="text-sm shrink-0">{CAT_ICON[loc.category] || '📍'}</span>
											<div class="min-w-0">
												<div class="text-xs font-semibold leading-tight truncate" style="color:#e2e8f0">{loc.name}</div>
												<div class="text-[10px]" style="color:#6366f1">{loc.category}</div>
											</div>
										</div>
									</button>
								{/each}
							</div>
						{/if}

					<!-- Browse by Category -->
					{:else}
						<div class="space-y-1.5">
							{#each getOrderedCategories() as cat}
								{#if groupedBuildings[cat]}
									<div class="rounded-xl overflow-hidden" style="border:1px solid rgba(99,102,241,0.15)">
										<!-- Category Header (collapsible) -->
										<button
											onclick={() => toggleCategory(cat)}
											class="w-full flex items-center justify-between px-3 py-2.5 transition-all"
											style="background:{expandedCategories.has(cat) ? 'rgba(99,102,241,0.15)' : 'rgba(30,27,75,0.4)'}"
										>
											<div class="flex items-center gap-2">
												<span class="text-sm">{CAT_ICON[cat] || '📍'}</span>
												<span class="text-xs font-semibold" style="color:{expandedCategories.has(cat) ? '#a5b4fc' : '#94a3b8'}">{cat}</span>
												<span class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
													style="background:rgba(99,102,241,0.2);color:#818cf8">{groupedBuildings[cat].length}</span>
											</div>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.5"
												style="transform:{expandedCategories.has(cat) ? 'rotate(180deg)' : ''};transition:transform 0.2s">
												<polyline points="6 9 12 15 18 9"/>
											</svg>
										</button>

										<!-- Category Items -->
										{#if expandedCategories.has(cat)}
											<div class="divide-y" style="divide-color:rgba(99,102,241,0.08)">
												{#each groupedBuildings[cat] as loc}
													<button
														onclick={() => selectLocation(loc)}
														class="w-full text-left px-4 py-2 transition-all text-xs font-medium flex items-center gap-2"
														style="background:{selectedLocation === loc ? 'rgba(99,102,241,0.18)' : 'transparent'};color:{selectedLocation === loc ? '#a5b4fc' : '#94a3b8'}"
													>
														{#if selectedLocation === loc}
															<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:#6366f1"></span>
														{:else}
															<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:rgba(99,102,241,0.3)"></span>
														{/if}
														<span class="truncate">{loc.name}</span>
													</button>
												{/each}
											</div>
										{/if}
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</aside>

	<!-- ════════════ MAP ════════════ -->
	<div class="flex-1 relative">
		<div bind:this={mapContainer} class="absolute inset-0"></div>

		<!-- Legend Card (bottom-right, above zoom) -->
		<div class="absolute bottom-16 right-4 z-10 rounded-2xl p-3 text-[11px] min-w-[170px]"
			style="background:rgba(15,23,42,0.88);backdrop-filter:blur(16px);border:1px solid rgba(99,102,241,0.25);box-shadow:0 10px 30px rgba(0,0,0,0.5)">
			<div class="flex items-center gap-1.5 mb-2.5">
				<div class="w-1 h-3 rounded-full" style="background:linear-gradient(#6366f1,#8b5cf6)"></div>
				<span class="font-bold uppercase tracking-widest text-[9px]" style="color:#6366f1">Keterangan</span>
			</div>
			<div class="space-y-1.5">
				<div class="flex items-center gap-2">
					<div class="w-3 h-3 rounded-full shrink-0 border-2 border-white" style="background:#22c55e"></div>
					<span style="color:#94a3b8">Titik Awal</span>
				</div>
				<div class="flex items-center gap-2">
					<div class="w-3 h-3 shrink-0 border-2 border-white" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:3px;transform:rotate(45deg)"></div>
					<span style="color:#94a3b8">Tujuan</span>
				</div>
				<div class="h-px my-1" style="background:rgba(99,102,241,0.2)"></div>
				<p class="text-[9px] uppercase tracking-wider font-bold" style="color:#4f46e5">Jalan QGIS</p>
				<div class="flex items-center gap-2">
					<div class="w-5 shrink-0" style="border-bottom:3px solid #ef4444"></div>
					<span style="color:#94a3b8">Kendaraan</span>
				</div>
				<div class="flex items-center gap-2">
					<div class="w-5 shrink-0" style="border-bottom:2px dashed #f97316"></div>
					<span style="color:#94a3b8">Pejalan Kaki</span>
				</div>
				<div class="h-px my-1" style="background:rgba(99,102,241,0.2)"></div>
				<p class="text-[9px] uppercase tracking-wider font-bold" style="color:#4f46e5">Rute OSRM</p>
				<div class="flex items-center gap-2">
					<div class="w-5 shrink-0" style="border-bottom:4px solid #f59e0b"></div>
					<span style="color:#94a3b8">Jalan Kaki</span>
				</div>
				<div class="flex items-center gap-2">
					<div class="w-5 shrink-0" style="border-bottom:4px solid #6366f1"></div>
					<span style="color:#94a3b8">Kendaraan</span>
				</div>
				<div class="h-px my-1" style="background:rgba(99,102,241,0.2)"></div>
				<div class="flex items-center gap-2">
					<div class="w-5 shrink-0" style="border-bottom:2px dashed #6366f1"></div>
					<span style="color:#94a3b8">Batas Kampus</span>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	:global(.leaflet-container) {
		background: #0f172a !important;
		font-family: 'Inter', sans-serif !important;
	}
	:global(.leaflet-control-zoom) {
		border: none !important;
		margin-bottom: 70px !important; /* above legend */
		box-shadow: 0 4px 20px rgba(0,0,0,0.4) !important;
	}
	:global(.leaflet-control-zoom a) { border-radius: 8px !important; margin-bottom: 2px !important; }
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
