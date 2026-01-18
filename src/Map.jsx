import { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = 'pk.eyJ1IjoiYXJhc2hjYyIsImEiOiJjbWhqeDFicjIxaHoyMmtxM3A1anphZG5vIn0.Hc43_oK4F3uS1k-LASpBMg';

const ProjectsMap = () => {
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const customLayersDataRef = useRef({ links: null, movements: null });
  const hasLoadedData = useRef(false);
  const [linksGeoJSON, setLinksGeoJSON] = useState(null);
  const [allMovements, setAllMovements] = useState(null);
  const [timeIntervals, setTimeIntervals] = useState([]);
  const [selectedTimeInt, setSelectedTimeInt] = useState('all');
  const [mapReady, setMapReady] = useState(false);
  const [selectedMovements, setSelectedMovements] = useState([]);
  const [timePeriod, setTimePeriod] = useState('AM');

  useEffect(() => {
    if (mapRef.current) return; // Prevent re-initialization

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/arashcc/cmhjx3one00fj01si1cik0fas',
      center: [144.65, -37.74],
      zoom: 12,
    });

    mapRef.current = map;

    map.once('load', () => {
      // Wait a bit longer to ensure everything is ready
      setTimeout(() => {
        setMapReady(true);
      }, 500);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    if (hasLoadedData.current && timePeriod === (hasLoadedData.current.period)) return;

    const map = mapRef.current;
    setSelectedMovements([]);
    setSelectedTimeInt('all');

    const loadData = async () => {
      try {
        // Clean up existing layers/sources
        ['movement-labels', 'movement-arrowheads', 'movement-lines', 'links-line'].forEach(id => {
          if (map.getLayer(id)) map.removeLayer(id);
        });
        ['movements', 'links'].forEach(id => {
          if (map.getSource(id)) map.removeSource(id);
        });

        const resLinks = await fetch('data/Links_Opt3.geojson');
        if (!resLinks.ok) throw new Error('Links_Opt3.geojson not found');
        const linksData = await resLinks.json();
        setLinksGeoJSON(linksData);

        map.addSource('links', { type: 'geojson', data: linksData });
        map.addLayer({ 
          id: 'links-line', 
          type: 'line', 
          source: 'links', 
          paint: { 'line-color': 'rgba(0, 0, 0, 1)', 'line-width': 2 } 
        });

        const fileName = timePeriod === 'AM' ? 'data/Node_AM.txt' : 'data/Node_PM.txt';
        const resMov = await fetch(fileName);
        if (!resMov.ok) throw new Error(`${fileName} not found`);
        const text = await resMov.text();
        const rows = text.split('\n').slice(1).filter(row => row.trim() && !row.includes('TIMEINT'));

        const movementFeatures = [];
        const uniqueTimeIntervals = new Set();

        rows.forEach(row => {
          if (!row.trim()) return;
          const cols = row.split('\t');
          if (cols[1]?.trim() === 'TIMEINT' || cols.length < 7) return;

          const timeInt = cols[1].trim();
          const fromLink = cols[3].trim();
          const toLink = cols[4].trim();
          const vehs = parseFloat(cols[5]) || 0;
          if (!timeInt.match(/^\d+-\d+$/)) return;

          uniqueTimeIntervals.add(timeInt);

          const fromFeature = linksData.features.find(f => String(f.properties['$LINK:NO']).trim() === fromLink);
          const toFeature = linksData.features.find(f => String(f.properties['$LINK:NO']).trim() === toLink);
          if (!fromFeature || !toFeature) return;

          const fromCoords = fromFeature.geometry.coordinates;
          const toCoords = toFeature.geometry.coordinates;
          const fromEnd = fromCoords[fromCoords.length - 1];
          const toStart = toCoords[0];

          const fromDir = fromCoords.length >= 2 ? {
            x: fromCoords[fromCoords.length - 1][0] - fromCoords[fromCoords.length - 2][0],
            y: fromCoords[fromCoords.length - 1][1] - fromCoords[fromCoords.length - 2][1]
          } : null;

          const toDir = toCoords.length >= 2 ? {
            x: toCoords[1][0] - toCoords[0][0],
            y: toCoords[1][1] - toCoords[0][1]
          } : null;

          let turnType = 'through';
          if (fromDir && toDir) {
            let angleDiff = (Math.atan2(toDir.y, toDir.x) - Math.atan2(fromDir.y, fromDir.x)) * 180 / Math.PI;
            while (angleDiff > 180) angleDiff -= 360;
            while (angleDiff < -180) angleDiff += 360;
            
            if (angleDiff >= -22.5 && angleDiff <= 22.5) turnType = 'through';
            else if (angleDiff > 22.5 && angleDiff <= 157.5) turnType = 'left';
            else if (angleDiff < -22.5 && angleDiff >= -157.5) turnType = 'right';
            else turnType = 'uturn';
          }

          const createCurvedLine = (start, end, segments = 20) => {
            const coords = [];
            const dx = end[0] - start[0];
            const dy = end[1] - start[1];
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (turnType === 'through') {
              for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                coords.push([start[0] + t * dx, start[1] + t * dy]);
              }
            } else {
              const midX = (start[0] + end[0]) / 2;
              const midY = (start[1] + end[1]) / 2;
              let offset = distance * (turnType === 'uturn' ? 0.35 : 0.2);
              if (turnType === 'right') offset = -offset;
              const controlX = midX + (dy / distance) * offset;
              const controlY = midY - (dx / distance) * offset;
              
              for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                coords.push([
                  (1 - t) * (1 - t) * start[0] + 2 * (1 - t) * t * controlX + t * t * end[0],
                  (1 - t) * (1 - t) * start[1] + 2 * (1 - t) * t * controlY + t * t * end[1]
                ]);
              }
            }
            return coords;
          };

          movementFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: createCurvedLine(fromEnd, toStart) },
            properties: { VEHS: vehs, TIMEINT: timeInt, TURNTYPE: turnType }
          });
        });

        const aggregatedMap = new Map();
        movementFeatures.forEach(feature => {
          const coords = feature.geometry.coordinates;
          const key = `${coords[0][0]},${coords[0][1]}-${coords[coords.length - 1][0]},${coords[coords.length - 1][1]}-${feature.properties.TURNTYPE}`;
          if (aggregatedMap.has(key)) {
            aggregatedMap.get(key).properties.VEHS += feature.properties.VEHS;
          } else {
            aggregatedMap.set(key, {
              type: 'Feature',
              geometry: feature.geometry,
              properties: { VEHS: feature.properties.VEHS, TIMEINT: 'all', TURNTYPE: feature.properties.TURNTYPE }
            });
          }
        });

        const aggregatedFeatures = Array.from(aggregatedMap.values());
        const movements = { type: 'FeatureCollection', features: [...movementFeatures, ...aggregatedFeatures] };
        setAllMovements(movements);
        customLayersDataRef.current = { links: linksData, movements: { type: 'FeatureCollection', features: aggregatedFeatures } };

        const convertSecondsToTimeLabel = (interval) => {
          const parts = interval.split('-');
          const startSec = parseInt(parts[0]);
          const endSec = parseInt(parts[1]);
          if (isNaN(startSec) || isNaN(endSec)) return interval;
          
          const hourOffset = timePeriod === 'AM' ? 4 : 13;
          const formatHour = (hour) => {
            if (isNaN(hour)) return 'N/A';
            if (hour === 0 || hour === 24) return '12am';
            if (hour < 12) return `${Math.floor(hour)}am`;
            if (hour === 12) return '12pm';
            return `${Math.floor(hour - 12)}pm`;
          };
          return `${formatHour((startSec / 3600) + hourOffset)}-${formatHour((endSec / 3600) + hourOffset)}`;
        };

        const intervalsWithLabels = Array.from(uniqueTimeIntervals)
          .map(interval => ({
            original: interval,
            display: convertSecondsToTimeLabel(interval),
            startSeconds: parseInt(interval.split('-')[0])
          }))
          .sort((a, b) => a.startSeconds - b.startSeconds);

        setTimeIntervals(intervalsWithLabels);

        map.addSource('movements', { type: 'geojson', data: { type: 'FeatureCollection', features: aggregatedFeatures } });
        map.addLayer({
          id: 'movement-lines',
          type: 'line',
          source: 'movements',
          paint: {
            'line-color': ['match', ['get', 'TURNTYPE'], 'left', 'rgba(0, 120, 255, 0.7)', 'right', 'rgba(255, 165, 0, 0.7)', 'uturn', 'rgba(200, 0, 200, 0)', 'rgba(0, 200, 0, 0.7)'],
            'line-width': ['interpolate', ['linear'], ['get', 'VEHS'], 0, 2, 500, 4, 1000, 6, 2000, 8]
          }
        });

        const loadArrowImages = async () => {
          for (const type of ['left', 'through', 'right', 'uturn']) {
            try {
              if (map.hasImage(`arrow-${type}`)) continue;
              const response = await fetch(`arrows/arrow-${type}.svg`);
              if (!response.ok) continue;
              const svgText = await response.text();
              const img = new Image(32, 32);
              await new Promise((resolve, reject) => {
                img.onload = () => { map.addImage(`arrow-${type}`, img); resolve(); };
                img.onerror = reject;
                img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
              });
            } catch (error) { console.error(`Error loading arrow-${type}:`, error); }
          }
        };
        
        await loadArrowImages();

        map.addLayer({
          id: 'movement-arrowheads',
          type: 'symbol',
          source: 'movements',
          layout: {
            'symbol-placement': 'line-center',
            'icon-image': ['match', ['get', 'TURNTYPE'], 'left', 'arrow-left', 'right', 'arrow-right', 'uturn', 'arrow-uturn', 'arrow-through'],
            'icon-size': ['interpolate', ['linear'], ['get', 'VEHS'], 0, 0.7, 500, 0.9, 1000, 1.1, 2000, 1.3],
            'icon-allow-overlap': true,
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'viewport'
          }
        });

        map.addLayer({
          id: 'movement-labels',
          type: 'symbol',
          source: 'movements',
          layout: {
            'symbol-placement': 'line-center',
            'text-field': ['to-string', ['get', 'VEHS']],
            'text-size': 14,
            'text-anchor': 'center',
            'text-allow-overlap': true
          },
          paint: {
            'text-color': 'rgba(255, 255, 255, 1)',
            'text-halo-color': 'rgba(0, 0, 0, 0.8)',
            'text-halo-width': 2
          }
        });

        setTimeout(() => {
          map.off('click', 'movement-labels');
          map.off('mouseenter', 'movement-labels');
          map.off('mouseleave', 'movement-labels');

          map.on('click', 'movement-labels', (e) => {
            if (e.features.length > 0) {
              const feature = e.features[0];
              const clickedCoords = feature.geometry.coordinates;
              const movementId = `${clickedCoords[0][0]},${clickedCoords[0][1]}-${clickedCoords[clickedCoords.length-1][0]},${clickedCoords[clickedCoords.length-1][1]}-${feature.properties.TURNTYPE}`;
              
              setSelectedMovements(prev => {
                if (prev.find(m => m.id === movementId)) return prev.filter(m => m.id !== movementId);
                
                const matchingMovements = movements.features.filter(f => {
                  const fCoords = f.geometry.coordinates;
                  return Math.abs(fCoords[0][0] - clickedCoords[0][0]) < 0.00001 &&
                         Math.abs(fCoords[0][1] - clickedCoords[0][1]) < 0.00001 &&
                         Math.abs(fCoords[fCoords.length-1][0] - clickedCoords[clickedCoords.length-1][0]) < 0.00001 &&
                         Math.abs(fCoords[fCoords.length-1][1] - clickedCoords[clickedCoords.length-1][1]) < 0.00001 &&
                         f.properties.TURNTYPE === feature.properties.TURNTYPE &&
                         f.properties.TIMEINT !== 'all';
                });
                
                const timeData = matchingMovements
                  .map(f => ({ timeInt: f.properties.TIMEINT, vehs: f.properties.VEHS, turnType: f.properties.TURNTYPE }))
                  .sort((a, b) => parseInt(a.timeInt.split('-')[0]) - parseInt(b.timeInt.split('-')[0]));
                
                return [...prev, { id: movementId, properties: feature.properties, timeData }];
              });
            }
          });

          map.on('mouseenter', 'movement-labels', () => map.getCanvas().style.cursor = 'pointer');
          map.on('mouseleave', 'movement-labels', () => map.getCanvas().style.cursor = '');
        }, 300);

        hasLoadedData.current = { period: timePeriod };
      } catch (err) {
        console.error('Error loading data:', err);
      }
    };

    loadData();
  }, [timePeriod, mapReady]);

  useEffect(() => {
    if (!mapRef.current || !allMovements || !mapReady) return;
    
    const map = mapRef.current;
    const source = map.getSource('movements');
    if (!source) return;

    const filteredMovements = {
      type: 'FeatureCollection',
      features: allMovements.features.filter(f => 
        selectedTimeInt === 'all' ? f.properties.TIMEINT === 'all' : f.properties.TIMEINT === selectedTimeInt
      )
    };

    source.setData(filteredMovements);
    customLayersDataRef.current.movements = filteredMovements;

    map.off('click', 'movement-labels');
    map.on('click', 'movement-labels', (e) => {
      if (e.features.length > 0) {
        const feature = e.features[0];
        const clickedCoords = feature.geometry.coordinates;
        const movementId = `${clickedCoords[0][0]},${clickedCoords[0][1]}-${clickedCoords[clickedCoords.length-1][0]},${clickedCoords[clickedCoords.length-1][1]}-${feature.properties.TURNTYPE}`;
        
        setSelectedMovements(prev => {
          if (prev.find(m => m.id === movementId)) return prev.filter(m => m.id !== movementId);
          
          const matchingMovements = allMovements.features.filter(f => {
            const fCoords = f.geometry.coordinates;
            return Math.abs(fCoords[0][0] - clickedCoords[0][0]) < 0.00001 &&
                   Math.abs(fCoords[0][1] - clickedCoords[0][1]) < 0.00001 &&
                   Math.abs(fCoords[fCoords.length-1][0] - clickedCoords[clickedCoords.length-1][0]) < 0.00001 &&
                   Math.abs(fCoords[fCoords.length-1][1] - clickedCoords[clickedCoords.length-1][1]) < 0.00001 &&
                   f.properties.TURNTYPE === feature.properties.TURNTYPE &&
                   f.properties.TIMEINT !== 'all';
          });
          
          const timeData = matchingMovements
            .map(f => ({ timeInt: f.properties.TIMEINT, vehs: f.properties.VEHS, turnType: f.properties.TURNTYPE }))
            .sort((a, b) => parseInt(a.timeInt.split('-')[0]) - parseInt(b.timeInt.split('-')[0]));
          
          return [...prev, { id: movementId, properties: feature.properties, timeData }];
        });
      }
    });
  }, [selectedTimeInt, allMovements, mapReady]);

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', top: '20px', right: '20px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 1 }}>
        <div style={{ background: 'white', padding: '12px 15px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', color: '#333' }}>Peak Period</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setTimePeriod('AM')} style={{ padding: '8px 16px', background: timePeriod === 'AM' ? '#3b82f6' : 'white', color: timePeriod === 'AM' ? 'white' : '#333', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: timePeriod === 'AM' ? 'bold' : 'normal', flex: 1 }}>AM Peak</button>
            <button onClick={() => setTimePeriod('PM')} style={{ padding: '8px 16px', background: timePeriod === 'PM' ? '#3b82f6' : 'white', color: timePeriod === 'PM' ? 'white' : '#333', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: timePeriod === 'PM' ? 'bold' : 'normal', flex: 1 }}>PM Peak</button>
          </div>
        </div>
        <div style={{ background: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.2)', minWidth: '180px' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: 'bold', borderBottom: '1px solid #ddd', paddingBottom: '8px' }}>Turn Types</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><div style={{ width: '30px', height: '3px', backgroundColor: 'rgba(0, 120, 255, 0.7)', borderRadius: '2px' }}></div><span style={{ fontSize: '14px' }}>Left Turn</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><div style={{ width: '30px', height: '3px', backgroundColor: 'rgba(0, 200, 0, 0.7)', borderRadius: '2px' }}></div><span style={{ fontSize: '14px' }}>Through</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><div style={{ width: '30px', height: '3px', backgroundColor: 'rgba(255, 165, 0, 0.7)', borderRadius: '2px' }}></div><span style={{ fontSize: '14px' }}>Right Turn</span></div>
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', top: '20px', left: '20px', background: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.2)', maxWidth: '300px', zIndex: 1 }}>
        <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '15px', paddingBottom: '15px', borderBottom: '2px solid #000', letterSpacing: '2px' }}>CLARITY</div>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 'bold', borderBottom: '1px solid rgba(14, 10, 10, 1)', paddingBottom: '10px' }}>2036 Option 3 - {timePeriod} Hourly Demand</h3>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 'bold' }}>Time Intervals</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button onClick={() => setSelectedTimeInt('all')} style={{ padding: '8px 12px', background: selectedTimeInt === 'all' ? '#3b82f6' : 'white', color: selectedTimeInt === 'all' ? 'white' : '#333', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: selectedTimeInt === 'all' ? 'bold' : 'normal' }}>All Time Intervals</button>
          {timeIntervals.map(timeInt => (
            <button key={timeInt.original} onClick={() => setSelectedTimeInt(timeInt.original)} style={{ padding: '8px 12px', background: selectedTimeInt === timeInt.original ? '#3b82f6' : 'white', color: selectedTimeInt === timeInt.original ? 'white' : '#333', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: selectedTimeInt === timeInt.original ? 'bold' : 'normal' }} onMouseEnter={(e) => { if (selectedTimeInt !== timeInt.original) e.target.style.background = '#f3f4f6'; }} onMouseLeave={(e) => { if (selectedTimeInt !== timeInt.original) e.target.style.background = 'white'; }}>{timeInt.display}</button>
          ))}
        </div>
      </div>
      {selectedMovements.length > 0 && (
        <div style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', maxWidth: '800px', maxHeight: '500px', overflowY: 'auto', zIndex: 1000 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid #3b82f6', paddingBottom: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>Selected Movements ({selectedMovements.length})</h3>
            <button onClick={() => setSelectedMovements([])} style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>Clear All</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {selectedMovements.map((movement, idx) => (
              <div key={movement.id} style={{ border: '1px solid #e5e7eb', borderRadius: '6px', padding: '15px', background: '#f9fafb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: '#1f2937' }}>Movement {idx + 1}: {movement.properties.TURNTYPE.charAt(0).toUpperCase() + movement.properties.TURNTYPE.slice(1)} Turn</h4>
                  <button onClick={() => setSelectedMovements(prev => prev.filter(m => m.id !== movement.id))} style={{ background: '#6b7280', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>Remove</button>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: 'white' }}>
                  <thead><tr style={{ background: '#f3f4f6', borderBottom: '2px solid #ddd' }}><th style={{ padding: '8px', textAlign: 'left', fontWeight: 'bold' }}>Time Interval</th><th style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>Vehicles</th></tr></thead>
                  <tbody>
                    {movement.timeData.map((data, index) => {
                      const convertSecondsToTimeLabel = (interval) => {
                        const parts = interval.split('-');
                        const startSec = parseInt(parts[0]), endSec = parseInt(parts[1]);
                        if (isNaN(startSec) || isNaN(endSec)) return interval;
                        const hourOffset = timePeriod === 'AM' ? 4 : 13;
                        const formatHour = (hour) => {
                          if (isNaN(hour)) return 'N/A';
                          if (hour === 0 || hour === 24) return '12am';
                          if (hour < 12) return `${Math.floor(hour)}am`;
                          if (hour === 12) return '12pm';
                          return `${Math.floor(hour - 12)}pm`;
                        };
                        return `${formatHour((startSec / 3600) + hourOffset)}-${formatHour((endSec / 3600) + hourOffset)}`;
                      };
                      return (
                        <tr key={index} style={{ borderBottom: '1px solid #e5e7eb', background: index % 2 === 0 ? 'white' : '#f9fafb' }}>
                          <td style={{ padding: '8px' }}>{convertSecondsToTimeLabel(data.timeInt)}</td>
                          <td style={{ padding: '8px', textAlign: 'right', fontWeight: '500' }}>{Math.round(data.vehs)}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: '2px solid #3b82f6', background: '#eff6ff', fontWeight: 'bold' }}>
                      <td style={{ padding: '8px' }}>Total</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{Math.round(movement.timeData.reduce((sum, d) => sum + d.vehs, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectsMap;