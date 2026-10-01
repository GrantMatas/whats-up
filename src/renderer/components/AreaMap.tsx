import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
maplibregl.setWorkerUrl(mapWorkerUrl);
import type { GeoJSONSource, Map as LibreMap, StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { LocateFixed, Minus, Plus } from 'lucide-react';
import type { AppSettings, Happening } from '../../shared/models';
import { bridge } from '../bridge';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';

export interface AreaMapProps {
  items: Happening[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  theme: 'light' | 'dark';
  compact?: boolean;
  streetMap?: boolean;
  location?: AppSettings['location'];
  heatmap?: boolean;
}

const COLORS: Record<string, string> = { music: '#8b719e', community: '#608879', traffic: '#c68a43', weather: '#5d8ca0', government: '#7b8390', safety: '#ad5c52', food:'#ae7459', technology:'#638f98', sports:'#728b54', events:'#8b719e', construction:'#c68a43', public_service:'#608879', news:'#7b8390', business:'#ae7459', education:'#638f98', arts:'#8b719e', other:'#7b8390', public_safety:'#ad5c52' };
const CATEGORY_ICONS: Record<string, string> = {
  music: '<path d="M9 18V5l12-2v13M9 8l12-2"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  community: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  traffic: '<path d="m5 17-1 4m15-4 1 4M6 3h12l3 14H3L6 3Zm-2 9h16M7 7h10"/>',
  weather: '<path d="M20 16.5A4.5 4.5 0 0 0 18 8a6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 7 17h12"/>',
  government: '<path d="m3 10 9-7 9 7H3Zm2 3v5m7-5v5m7-5v5M3 21h18"/>',
  safety: '<path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4Zm0 5v5m0 3h.01"/>',
  food: '<path d="M4 3v5a3 3 0 0 0 6 0V3M7 3v19m13 0V3c-4 2-5 8 0 9"/>',
  technology: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4M9 9h6v6H9V9Z"/>',
  sports: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.5 5.5c7 2 7 11 0 13m13-13c-7 2-7 11 0 13"/>',
  events:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h.01m4 0h.01m4 0h.01"/>',
  news:'<path d="M4 4h16v16H4V4Zm3 4h10M7 12h3m4 0h3M7 16h3m4 0h3"/>',
  business:'<path d="M3 10 5 3h14l2 7M5 10v11h14V10M9 21v-7h6v7M3 10h18"/>',
  education:'<path d="m2 9 10-6 10 6-10 6-10-6Zm4 3v6c4 3 8 3 12 0v-6m4-3v8"/>',
  arts:'<path d="M12 3a9 9 0 0 0 0 18h2a2 2 0 0 0 0-4 2 2 0 0 1 0-4h3a4 4 0 0 0 4-4c0-4-4-6-9-6Z"/><circle cx="7.5" cy="9" r=".5"/><circle cx="11" cy="6.5" r=".5"/><circle cx="16" cy="7.5" r=".5"/>',
  other:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1"/>',
};
CATEGORY_ICONS.construction = CATEGORY_ICONS.traffic;
CATEGORY_ICONS.public_service = CATEGORY_ICONS.community;
CATEGORY_ICONS.public_safety = CATEGORY_ICONS.safety;

const palette = (dark: boolean) => dark ? {
  land: '#27302a', block: '#2e382f', park: '#354a36', water: '#324b50', street: '#384139', avenue: '#475047', major: '#667064', highway: '#796e56', outline: '#27302a',
} : {
  land: '#ecece2', block: '#e4e5d8', park: '#d1dac1', water: '#bdd2cd', street: '#f6f5ed', avenue: '#fffef6', major: '#faf9f0', highway: '#decda9', outline: '#d5d8c8',
};

function createStyle(dark:boolean):StyleSpecification {return {version:8,sources:{happenings:{type:'geojson',data:{type:'FeatureCollection',features:[]}}},layers:[
{id:'land',type:'background',paint:{'background-color':dark?'#28302c':'#eceee9'}},
{id:'event-areas',type:'fill',source:'happenings',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['get','color'],'fill-opacity':0.2}},
{id:'event-area-borders',type:'line',source:'happenings',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':['get','color'],'line-width':2,'line-dasharray':[3,2]}},
{id:'event-roads',type:'line',source:'happenings',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':['get','color'],'line-width':5,'line-opacity':0.85}},
]};}
const emptyCollection: FeatureCollection = { type: 'FeatureCollection', features: [] };

export default function AreaMap({ items, selectedId, onSelect, theme, compact = false, streetMap = true, location, heatmap = false }: AreaMapProps) {
  const mappedItems = items.filter(hasCoordinates);
  const useStreetTiles = streetMap;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const markersRef = useRef(new Map<string, maplibregl.Marker>());
  const itemsRef = useRef(items);
  const selectRef = useRef(onSelect);
  const themeRef = useRef(theme);
  const streetRef = useRef(useStreetTiles);
  const locationRef = useRef(location);
  const initialFitRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [markersReady, setMarkersReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [tileStatus, setTileStatus] = useState<'offline' | 'loading' | 'ready' | 'failed'>('offline');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  itemsRef.current = items;
  selectRef.current = onSelect;
  themeRef.current = theme;
  streetRef.current = useStreetTiles;
  locationRef.current = location;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced';

  useEffect(() => {
    if (!containerRef.current) return;
    let map: LibreMap;
    setMapFailed(false);
    try {
      const origin:[number,number] = locationRef.current ? [locationRef.current.longitude,locationRef.current.latitude] : [0,0];
      map = new maplibregl.Map({ container: containerRef.current, style: createStyle(themeRef.current === 'dark'), center:origin, zoom: !locationRef.current ? 2 : compact ? 12.5 : 11.9, minZoom:1, maxZoom: 18, attributionControl: false, pitchWithRotate: false, dragRotate: false, touchPitch: false, maxBounds:undefined });
      mapRef.current = map;
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 80, unit: 'imperial' }), 'bottom-left');
      map.on('load', () => {
        setReady(true);
      });
      map.on('click', 'event-areas', event => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === 'string') selectRef.current(id);
      });
      map.on('click', 'event-roads', event => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === 'string') selectRef.current(id);
      });
      map.on('mouseenter', 'event-areas', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'event-areas', () => { map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'event-roads', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'event-roads', () => { map.getCanvas().style.cursor = ''; });
      map.on('error', event => {
        if (streetRef.current && ((event as { sourceId?: string }).sourceId === 'street-tiles' || map.getSource('street-tiles'))) {
          if (map.getLayer('street-tiles')) map.setLayoutProperty('street-tiles', 'visibility', 'none');
          setTileStatus('failed');
        }
      });
      map.on('sourcedata', event => { if (event.sourceId === 'street-tiles' && event.isSourceLoaded) setTileStatus(value => value === 'failed' ? value : 'ready'); });
    } catch {
      setMapFailed(true);
      return;
    }
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      initialFitRef.current = false;
      setReady(false);
      setMarkersReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getLayer('land')) return;
    const p = palette(theme === 'dark');
    map.setPaintProperty('land','background-color',theme === 'dark' ? '#28302c' : '#eceee9');
    if (map.getLayer('street-tiles')) map.setPaintProperty('street-tiles','raster-opacity',theme === 'dark' ? 0.7 : 0.9);
  }, [ready, theme]);

  useEffect(() => {
    if (ready && mapRef.current?.getLayer('land') && location) mapRef.current.flyTo({ center:[location.longitude,location.latitude], zoom:compact ? 12.5 : 11.9, duration:reducedMotion() ? 0 : 500 });
  },[ready,location?.latitude,location?.longitude]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getLayer('land')) return;
    if (useStreetTiles) {
      setTileStatus('loading');
      if (!map.getSource('street-tiles')) {
        map.addSource('street-tiles', { type:'raster', tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize:256, maxzoom:19, attribution:'© OpenStreetMap contributors' });
        map.addLayer({ id:'street-tiles', type:'raster', source:'street-tiles', paint:{'raster-opacity':theme === 'dark' ? 0.7 : 0.9,'raster-saturation':-0.5} },'event-areas');
      } else map.setLayoutProperty('street-tiles','visibility','visible');
    } else {
      if (map.getLayer('street-tiles')) map.removeLayer('street-tiles');
      if (map.getSource('street-tiles')) map.removeSource('street-tiles');
      setTileStatus('offline');
    }
  }, [ready, useStreetTiles]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getLayer('land')) return;
    const features: Feature[] = items.filter(item => item.geometry).map(item => ({ type:'Feature', geometry:item.geometry as Geometry, properties:{ id:item.id, color:COLORS[item.category] || COLORS.community } }));
    (map.getSource('happenings') as GeoJSONSource)?.setData(features.length ? { type:'FeatureCollection', features } : emptyCollection);
    const points:FeatureCollection={type:'FeatureCollection',features:items.filter(hasCoordinates).map(item=>({type:'Feature',geometry:{type:'Point',coordinates:coordinates(item)},properties:{id:item.id}}))};
    if(!map.getSource('activity-density')){map.addSource('activity-density',{type:'geojson',data:points});map.addLayer({id:'activity-density',type:'heatmap',source:'activity-density',paint:{'heatmap-radius':35,'heatmap-opacity':.65,'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,'rgba(96,136,121,0)',.2,'#94bbaa',.5,'#608879',.8,'#c68a43',1,'#aa4d32']}});}else (map.getSource('activity-density') as GeoJSONSource).setData(points);
    map.setLayoutProperty('activity-density','visibility',heatmap?'visible':'none');
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current.clear();
    for (const item of (heatmap?[]:items.filter(hasCoordinates).slice(0,600))) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `area-map-pin${item.id === selectedId ? ' is-selected' : ''}`;
      button.style.setProperty('--pin-color', COLORS[item.category] || COLORS.community);
      button.title = item.title;
      button.setAttribute('aria-label', `Open ${item.title}`);
      button.setAttribute('aria-pressed', String(item.id === selectedId));
      button.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CATEGORY_ICONS[item.category] || CATEGORY_ICONS.community}</svg>`;
      button.addEventListener('click', event => { event.stopPropagation(); selectRef.current(item.id); });
      const marker = new maplibregl.Marker({ element:button, anchor:'center' }).setLngLat(coordinates(item)).addTo(map);
      markersRef.current.set(item.id, marker);
    }
    setMarkersReady(true);
  }, [items, ready, heatmap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getLayer('land')) return;
    markersRef.current.forEach((marker, id) => {
      marker.getElement().classList.toggle('is-selected', id === selectedId);
      marker.getElement().setAttribute('aria-pressed', String(id === selectedId));
    });
    const selected = itemsRef.current.find(item => item.id === selectedId);
    if (selected && hasCoordinates(selected)) map.flyTo({ center:coordinates(selected), zoom: Math.max(map.getZoom(),13), duration: reducedMotion() ? 0 : 650, essential:false });
  }, [selectedId, ready]);

  function resetView() {
    const map = mapRef.current;
    if (!map) return;
    if (mappedItems.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      mappedItems.forEach(item => bounds.extend(coordinates(item)));
      map.fitBounds(bounds, { padding: compact ? 54 : 76, maxZoom:12.5, duration: reducedMotion() ? 0 : 500 });
    } else map.flyTo({ center: mappedItems.length ? coordinates(mappedItems[0]) : location ? [location.longitude,location.latitude] : [0,0], zoom:!location && !mappedItems.length ? 2 : 11.9, duration:reducedMotion() ? 0 : 500 });
  }

  return <section className={`area-map${compact ? ' area-map-compact' : ''}${theme === 'dark' ? ' area-map-dark' : ''}`} data-map-ready={mapFailed ? 'failed' : ready && markersReady ? 'true' : 'false'} data-map-status={mapFailed ? 'unavailable' : ready && markersReady ? 'ready' : 'loading'} aria-label={`Map of happenings near ${location?.name || 'your selected area'}`}>
    <div ref={containerRef} className="area-map-canvas" aria-label={'Interactive street map'} />
    {mapFailed && <div className="area-map-unavailable"><LocateFixed size={28}/><strong>Map unavailable on this device</strong><span>Explore all places in the accessible list below.</span></div>}
    <div className="area-map-topline"><span className="area-map-local"><span/>{location?.name || 'SELECT AN AREA'}</span><span className="area-map-count">{mappedItems.length} mapped{mappedItems.length < items.length ? ` · ${items.length-mappedItems.length} unlocated` : ''}</span></div>
    <div className="area-map-controls" aria-label="Map controls">
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={!ready} onClick={() => mapRef.current?.zoomIn({ duration:reducedMotion() ? 0 : 200 })}><Plus size={17}/></button>
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={!ready} onClick={() => mapRef.current?.zoomOut({ duration:reducedMotion() ? 0 : 200 })}><Minus size={17}/></button>
      <button type="button" aria-label="Show all places" title="Show all places" disabled={!ready} onClick={resetView}><LocateFixed size={17}/></button>
    </div>
    <div className="area-map-footer"><button type="button" className="area-map-list-toggle" aria-expanded={showList || mapFailed} onClick={() => setShowList(!showList)}>List of places</button><span className="area-map-disclaimer">{'Source locations · may be approximate'}</span></div>
    {useStreetTiles && <div className="area-map-tile-status" role="status">{linkError || (tileStatus === 'failed' ? 'Street tiles unavailable · locations remain available' : tileStatus === 'loading' ? 'Loading street tiles…' : 'Street map')}</div>}
    {useStreetTiles && <a className="area-map-osm-attribution" href="https://www.openstreetmap.org/copyright" onClick={event => { event.preventDefault(); setLinkError(null); bridge.openExternal('https://www.openstreetmap.org/copyright').catch(() => setLinkError('Unable to open the attribution page.')); }}>© OpenStreetMap contributors</a>}
    {(showList || mapFailed) && <div className="area-map-place-list" aria-label="Places in the current results">{items.length ? items.map(item => <button type="button" key={item.id} className={item.id === selectedId ? 'is-selected' : ''} onClick={() => onSelect(item.id)}><span style={{ background:COLORS[item.category] || COLORS.community }}/>{item.title}{!hasCoordinates(item) ? ' · Location unknown' : ''}</button>) : <p>No places match these filters.</p>}</div>}
  </section>;
}

// Shared records store approximate coordinates; MapLibre expects longitude first.
function hasCoordinates(item:Happening):item is Happening & { longitude:number;latitude:number } {
  return item.longitude != null && item.latitude != null && Number.isFinite(item.longitude) && Number.isFinite(item.latitude);
}
function coordinates(item: Happening & { longitude:number;latitude:number }): [number, number] {
  return [item.longitude, item.latitude];
}
