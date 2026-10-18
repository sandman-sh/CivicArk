import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, ZoomControl, GeoJSON } from 'react-leaflet';
import type { FeatureCollection, Geometry } from 'geojson';
import type { PathOptions } from 'leaflet';
import { MUMBAI_WARDS, normalizeWardCode } from '../data/wardDirectory';
import type { CivicTender, DefectChallenge } from '../types/civic';

const WARD_BOUNDARIES_URL = 'https://prsrvgisapp.mcgm.gov.in/server/rest/services/mcgm/MCGMGIS_Departments_Master_All_Layers/MapServer/238/query?where=1%3D1&outFields=NAME%2CFLAGID&returnGeometry=true&outSR=4326&f=geojson';

type WardProperties = { NAME?: string; FLAGID?: string };
type WardCollection = FeatureCollection<Geometry, WardProperties>;

export function RealWardMap({
  selectedWard,
  onSelect,
  tenders,
  defects,
}: {
  selectedWard: string;
  onSelect: (ward: string) => void;
  tenders?: CivicTender[];
  defects?: DefectChallenge[];
}) {
  const [wardBoundaries, setWardBoundaries] = useState<WardCollection | null>(null);
  const [boundaryStatus, setBoundaryStatus] = useState<'loading' | 'live' | 'unavailable'>('loading');
  const [reportFilter, setReportFilter] = useState('all');
  useEffect(() => {
    const controller = new AbortController();
    fetch(WARD_BOUNDARIES_URL, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(`BMC GIS returned ${response.status}`); return response.json() as Promise<WardCollection>; })
      .then(data => { if (data.type !== 'FeatureCollection' || !data.features?.length) throw new Error('Ward features unavailable'); setWardBoundaries(data); setBoundaryStatus('live'); })
      .catch(error => { if (!controller.signal.aborted) { console.warn('BMC ward boundary service unavailable:', error); setBoundaryStatus('unavailable'); } });
    return () => controller.abort();
  }, []);
  const wardNames = useMemo(() => new Map(MUMBAI_WARDS.map(ward => [normalizeWardCode(ward.code), ward.name])), []);
  const reportClusters = useMemo(() => {
    const filtered = (defects || []).filter(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && (reportFilter === 'all' || item.status === reportFilter || item.severity === reportFilter));
    const groups = new Map<string, DefectChallenge[]>();
    filtered.forEach(item => { const key = `${Math.round(item.latitude! * 1000)}:${Math.round(item.longitude! * 1000)}`; groups.set(key, [...(groups.get(key) || []), item]); });
    return [...groups.values()];
  }, [defects, reportFilter]);
  const boundaryStyle = (feature?: GeoJSON.Feature<Geometry, WardProperties>): PathOptions => {
    const code = normalizeWardCode(feature?.properties?.NAME || '');
    const active = selectedWard === code;
    return { color: active ? '#83f5e4' : '#6fcfc8', weight: active ? 2.8 : 1.1, opacity: active ? .98 : .58, fillColor: active ? '#48d9ca' : '#57bdbe', fillOpacity: active ? .19 : .07 };
  };
  return <div className="real-map-shell">
    <div className="map-filterbar"><label>Reports<select value={reportFilter} onChange={event => setReportFilter(event.target.value)}><option value="all">All status / severity</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="assigned">Routed</option><option value="repair_submitted">Repair submitted</option><option value="verified">Verified</option><option value="critical">Critical severity</option><option value="hazardous">Hazardous</option></select></label><span>{reportClusters.length} map cluster{reportClusters.length === 1 ? '' : 's'} · {reportClusters.reduce((sum, group) => sum + group.length, 0)} geotagged reports</span></div>
    <MapContainer center={[19.0760, 72.8777]} zoom={10} minZoom={9} maxZoom={18} scrollWheelZoom className="real-map" zoomControl={false}>
      <ZoomControl position="bottomright" />
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {wardBoundaries && <GeoJSON key={selectedWard} data={wardBoundaries} style={boundaryStyle} onEachFeature={(feature, layer) => {
        const code = normalizeWardCode(feature.properties?.NAME || '');
        const name = wardNames.get(code) || `BMC ${feature.properties?.NAME || 'ward'}`;
        const workCount = tenders?.filter(tender => normalizeWardCode(tender.ward) === code).length;
        const defectCount = defects?.filter(defect => normalizeWardCode(defect.ward) === code).length;
        layer.bindTooltip(`${feature.properties?.NAME || code} · ${name}`, { sticky: true, className: 'ward-tooltip' });
        layer.bindPopup(`<strong>${feature.properties?.NAME || code}</strong><br>${name}${workCount !== undefined && defectCount !== undefined ? `<br>${workCount} works · ${defectCount} reports` : ''}`);
        layer.on('click', () => onSelect(selectedWard === code ? 'All' : code));
      }} />}
      {reportClusters.map(group => <CircleMarker key={group[0].key || group[0].txHash || `${group[0].latitude}-${group[0].longitude}`} center={[group.reduce((sum, item) => sum + item.latitude!, 0) / group.length, group.reduce((sum, item) => sum + item.longitude!, 0) / group.length]} radius={group.length > 1 ? Math.min(19, 9 + group.length * 1.4) : 7} pathOptions={{ color: '#d2fff8', fillColor: group.length > 1 ? '#f0aa56' : '#5ff4da', fillOpacity: .92, weight: 2 }}><Popup><strong>{group.length > 1 ? `${group.length} nearby reports` : group[0].anonymousDisplay ? 'Anonymous public report' : 'Civic report'}</strong>{group.map((item, index) => <div key={item.key || index} style={{ marginTop: 6 }}>{item.ward} · {item.roadName}<br />{item.severity} · {item.status.replaceAll('_', ' ')}</div>)}</Popup></CircleMarker>)}
    </MapContainer>
    <div className="real-map-caption"><span>OpenStreetMap streets · BMC GIS ward boundaries</span><span>{boundaryStatus === 'live' ? '24 ward polygons · live public GIS' : boundaryStatus === 'loading' ? 'Loading municipal boundaries…' : 'Municipal GIS unavailable · street map remains live'}</span></div>
  </div>;
}
