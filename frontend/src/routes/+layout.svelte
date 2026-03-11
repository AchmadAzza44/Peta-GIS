<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';

	// Live clock
	onMount(() => {
		function tick() {
			const el = document.getElementById('clock');
			if (el) el.textContent = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
		}
		tick();
		const interval = setInterval(tick, 1000);
		return () => clearInterval(interval);
	});
</script>

<svelte:head>
	<title>Peta Kampus UNIB — Sistem Navigasi & Jelajah Kampus</title>
	<meta name="description" content="Sistem peta interaktif kampus Universitas Bengkulu. Temukan lokasi gedung, rute UTBK, dan jelajahi seluruh kampus UNIB." />
	<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
	<link rel="stylesheet" href="https://unpkg.com/leaflet-routing-machine@latest/dist/leaflet-routing-machine.css" />
</svelte:head>

<div class="h-screen w-full flex flex-col" style="background:#0f172a">

	<!-- ══ HEADER ══ -->
	<header class="relative z-30 shrink-0" style="background:linear-gradient(135deg,#1e1b4b 0%,#1e293b 60%,#0f172a 100%);border-bottom:1px solid rgba(99,102,241,0.25)">
		<div class="flex items-center justify-between h-14 px-5">

			<!-- Logo + Title -->
			<div class="flex items-center gap-3">
				<div class="relative">
					<div class="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm text-white"
						style="background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 0 20px rgba(99,102,241,0.5)">
						U
					</div>
					<div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 bg-emerald-400 animate-pulse"
						style="border-color:#0f172a"></div>
				</div>
				<div>
					<h1 class="text-base font-bold leading-none" style="color:#f1f5f9;letter-spacing:-0.02em">
						Peta Kampus UNIB
					</h1>
					<p class="text-[10px] leading-none mt-0.5" style="color:#6366f1">Universitas Bengkulu</p>
				</div>
			</div>

			<!-- Center badge -->
			<div class="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full"
				style="background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.3)">
				<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
				<span class="text-[11px] font-medium" style="color:#a5b4fc">Sistem Navigasi & Jelajah Kampus</span>
			</div>

			<!-- Right info -->
			<div class="flex items-center gap-2 text-[11px]" style="color:#64748b">
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
				</svg>
				<span id="clock">--:--</span>
			</div>
		</div>
	</header>

	<main class="flex-1 flex overflow-hidden">
		<slot />
	</main>
</div>

