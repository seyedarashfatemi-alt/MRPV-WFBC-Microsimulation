import { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken =
  'pk.eyJ1IjoiYXJhc2hjYyIsImEiOiJjbWhqeDFicjIxaHoyMmtxM3A1anphZG5vIn0.Hc43_oK4F3uS1k-LASpBMg';

const ProjectsMap = () => {
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const [linksGeoJSON, setLinksGeoJSON] = useState(null);
  const [allMovements, setAllMovements] = useState(null);
  const [timeIntervals, setTimeIntervals] = useState([]);
  const [selectedTimeInt, setSelectedTimeInt] = useState('all');

  useEffect(() => {
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/arashcc/cmhjx3one00fj01si1cik0fas',
      center: [144.65, -37.74],
      zoom: 12,
    });

    mapRef.current = map;

    map.on('load', async () => {
      try {
        // 1️⃣ Load Links GeoJSON
        const resLinks = await fetch('/data/Links_Opt3.geojson');
        if (!resLinks.ok) throw new Error('Links_Opt3.geojson not found');
        const linksData = await resLinks.json();
        setLinksGeoJSON(linksData);

        // Add Links source & layer
        map.addSource('links', { type: 'geojson', data: linksData });
        map.addLayer({
          id: 'links-line',
          type: 'line',
          source: 'links',
          paint: {
            'line-color': 'rgba(0, 0, 0, 1)',
            'line-width': 2,
          },
        });

        // 2️⃣ Load Node_AM.txt movements
        const resMov = await fetch('/data/Node_AM.txt');
        if (!resMov.ok) throw new Error('Node_AM.txt not found');
        const text = await resMov.text();
        const rows = text.split('\n').slice(1); // skip header

        console.log('📄 Total rows in Node_AM.txt:', rows.length);

        const movementFeatures = [];
        const uniqueTimeIntervals = new Set();

        rows.forEach((row, index) => {
          if (!row.trim()) return; // skip empty rows
          const cols = row.split('\t');
          
          if (cols.length < 7) return;

          const timeInt = cols[1].trim();
          const fromLink = cols[3].trim();
          const toLink = cols[4].trim();
          const vehs = parseFloat(cols[5]) || 0;

          uniqueTimeIntervals.add(timeInt);

          // Find from/to coordinates from Links GeoJSON using $LINK:NO property
          const fromFeature = linksData.features.find(
            f => String(f.properties['$LINK:NO']).trim() === fromLink
          );
          const toFeature = linksData.features.find(
            f => String(f.properties['$LINK:NO']).trim() === toLink
          );

          if (!fromFeature || !toFeature) {
            return; // skip if coordinates not found
          }

          // Get the end point of the "from link" (last coordinate)
          const fromCoords = fromFeature.geometry.coordinates;
          const fromEnd = fromCoords[fromCoords.length - 1];
          
          // Get the start point of the "to link" (first coordinate)
          const toCoords = toFeature.geometry.coordinates;
          const toStart = toCoords[0];

          // Calculate the direction vectors for from and to links
          const fromDir = fromCoords.length >= 2 ? {
            x: fromCoords[fromCoords.length - 1][0] - fromCoords[fromCoords.length - 2][0],
            y: fromCoords[fromCoords.length - 1][1] - fromCoords[fromCoords.length - 2][1]
          } : null;

          const toDir = toCoords.length >= 2 ? {
            x: toCoords[1][0] - toCoords[0][0],
            y: toCoords[1][1] - toCoords[0][1]
          } : null;

          // Determine turn type based on relative angle
          let turnType = 'through'; // default
          
          if (fromDir && toDir) {
            // Calculate angle between vectors using atan2
            const fromAngle = Math.atan2(fromDir.y, fromDir.x);
            const toAngle = Math.atan2(toDir.y, toDir.x);
            
            // Calculate relative angle difference (-180 to 180 degrees)
            let angleDiff = ((toAngle - fromAngle) * 180 / Math.PI);
            
            // Normalize to -180 to 180 range
            while (angleDiff > 180) angleDiff -= 360;
            while (angleDiff < -180) angleDiff += 360;
            
            // Log first 5 movements for debugging
            if (index < 5) {
              console.log(`Movement ${index + 1}: fromLink=${fromLink}, toLink=${toLink}, angle=${angleDiff.toFixed(1)}°`);
            }
            
            // Classify turn type based on angle
            if (angleDiff >= -22.5 && angleDiff <= 22.5) {
              turnType = 'through';  // -22.5° to 22.5°
            } else if (angleDiff > 22.5 && angleDiff <= 157.5) {
              turnType = 'left';     // 22.5° to 157.5°
            } else if (angleDiff < -22.5 && angleDiff >= -157.5) {
              turnType = 'right';    // -22.5° to -157.5°
            } else {
              turnType = 'uturn';    // 157.5° to 180° or -157.5° to -180°
            }
          }

          // Create curved path using quadratic bezier curve
          const createCurvedLine = (start, end, segments = 20) => {
            const coords = [];
            const dx = end[0] - start[0];
            const dy = end[1] - start[1];
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (turnType === 'through') {
              // Straight line for through movements
              for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                coords.push([
                  start[0] + t * dx,
                  start[1] + t * dy
                ]);
              }
            } else {
              // Curved line for turns
              const midX = (start[0] + end[0]) / 2;
              const midY = (start[1] + end[1]) / 2;
              
              // Curve offset proportional to distance
              let offset = distance * 0.2;
              
              // For U-turns, make the curve more pronounced
              if (turnType === 'uturn') {
                offset = distance * 0.35;
              }
              
              // Reverse curve direction for right turns
              if (turnType === 'right') {
                offset = -offset;
              }
              
              const controlX = midX + (dy / distance) * offset;
              const controlY = midY - (dx / distance) * offset;
              
              // Generate points along the curve
              for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const x = (1 - t) * (1 - t) * start[0] + 2 * (1 - t) * t * controlX + t * t * end[0];
                const y = (1 - t) * (1 - t) * start[1] + 2 * (1 - t) * t * controlY + t * t * end[1];
                coords.push([x, y]);
              }
            }
            return coords;
          };

          const curvedCoords = createCurvedLine(fromEnd, toStart);

          movementFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: curvedCoords,
            },
            properties: { 
              VEHS: vehs,
              TIMEINT: timeInt,
              TURNTYPE: turnType
            },
          });
        });

        console.log('Movement features created:', movementFeatures.length);

        // Aggregate volumes for "all" time interval
        // Group by from-to link pair and sum volumes
        const aggregatedMap = new Map();
        
        movementFeatures.forEach(feature => {
          // Create a unique key for each movement (from link end to to link start)
          const coords = feature.geometry.coordinates;
          const startCoord = coords[0];
          const endCoord = coords[coords.length - 1];
          const key = `${startCoord[0]},${startCoord[1]}-${endCoord[0]},${endCoord[1]}-${feature.properties.TURNTYPE}`;
          
          if (aggregatedMap.has(key)) {
            // Add to existing volume
            const existing = aggregatedMap.get(key);
            existing.properties.VEHS += feature.properties.VEHS;
          } else {
            // Create new aggregated feature
            aggregatedMap.set(key, {
              type: 'Feature',
              geometry: feature.geometry,
              properties: {
                VEHS: feature.properties.VEHS,
                TIMEINT: 'all',
                TURNTYPE: feature.properties.TURNTYPE
              }
            });
          }
        });
        
        // Create aggregated features array
        const aggregatedFeatures = Array.from(aggregatedMap.values());
        console.log('Aggregated features for "all":', aggregatedFeatures.length);
        
        // Combine all movements with aggregated "all" movements
        const allFeaturesWithAggregated = [...movementFeatures, ...aggregatedFeatures];

        const movements = {
          type: 'FeatureCollection',
          features: allFeaturesWithAggregated,
        };
        
        setAllMovements(movements);
        
        // Convert seconds to time label
        const convertSecondsToTimeLabel = (interval) => {
          // Split "3600-7200" into start and end
          const parts = interval.split('-');
          const startSec = parseInt(parts[0]);
          const endSec = parseInt(parts[1]);
          
          // Convert seconds to hours and add 4 hour offset
          // 3600 seconds = 1 hour, but we want 3600 to be 5am (4 hour offset)
          const startHour = (startSec / 3600) + 4;
          const endHour = (endSec / 3600) + 4;
          
          // Format hour to 12-hour format with am/pm
          const formatHour = (hour) => {
            if (hour === 0 || hour === 24) return '12am';
            if (hour < 12) return `${hour}am`;
            if (hour === 12) return '12pm';
            return `${hour - 12}pm`;
          };
          
          return `${formatHour(startHour)}-${formatHour(endHour)}`;
        };
        
        // Create array of objects with both original value and display label
        const intervalsWithLabels = Array.from(uniqueTimeIntervals).map(interval => ({
          original: interval,
          display: convertSecondsToTimeLabel(interval),
          startSeconds: parseInt(interval.split('-')[0])
        }));
        
        // Sort by start seconds
        intervalsWithLabels.sort((a, b) => a.startSeconds - b.startSeconds);
        
        setTimeIntervals(intervalsWithLabels);
        console.log('Time intervals converted:', intervalsWithLabels);

        // Add movements source
        map.addSource('movements', { type: 'geojson', data: movements });

        // Add movement lines with variable width and color based on turn type
        map.addLayer({
          id: 'movement-lines',
          type: 'line',
          source: 'movements',
          paint: {
            'line-color': [
              'match',
              ['get', 'TURNTYPE'],
              'left', 'rgba(0, 120, 255, 0.7)',      // Blue for left
              'right', 'rgba(255, 165, 0, 0.7)',     // Orange for right
              'uturn', 'rgba(200, 0, 200, 0)',     // Purple for U-turn
              'rgba(0, 200, 0, 0.7)'                 // Green for through
            ],
            'line-width': [
              'interpolate',
              ['linear'],
              ['get', 'VEHS'],
              0, 2,      // 0 vehicles = 2px width
              500, 4,    // 500 vehicles = 4px width
              1000, 6,   // 1000 vehicles = 6px width
              2000, 8    // 2000+ vehicles = 8px width
            ],
          },
        });

        // Load arrow SVG files
        const loadArrowImages = async () => {
          const arrowTypes = ['left', 'through', 'right', 'uturn'];
          
          for (const type of arrowTypes) {
            try {
              // Fetch the SVG file from the public folder
              const response = await fetch(`/arrows/arrow-${type}.svg`);
              if (!response.ok) {
                console.warn(`Could not load arrow-${type}.svg, using fallback`);
                continue;
              }
              const svgText = await response.text();
              
              // Create image from SVG
              const img = new Image(32, 32);
              await new Promise((resolve, reject) => {
                img.onload = () => {
                  map.addImage(`arrow-${type}`, img);
                  resolve();
                };
                img.onerror = () => {
                  console.error(`Failed to load arrow-${type}`);
                  reject();
                };
                img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
              });
            } catch (error) {
              console.error(`Error loading arrow-${type}:`, error);
            }
          }
          console.log('✅ All arrow images loaded');
        };

        await loadArrowImages();
        
        // Add arrowheads at the center of each movement line
        map.addLayer({
          id: 'movement-arrowheads',
          type: 'symbol',
          source: 'movements',
          layout: {
            'symbol-placement': 'line-center',
            'icon-image': [
              'match',
              ['get', 'TURNTYPE'],
              'left', 'arrow-left',
              'right', 'arrow-right',
              'uturn', 'arrow-uturn',
              'arrow-through' // default for through
            ],
            'icon-size': [
              'interpolate',
              ['linear'],
              ['get', 'VEHS'],
              0, 0.7,
              500, 0.9,
              1000, 1.1,
              2000, 1.3
            ],
            'icon-allow-overlap': true,
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'viewport',
          },
        });
        
        // Add vehicle count labels
        map.addLayer({
          id: 'movement-labels',
          type: 'symbol',
          source: 'movements',
          layout: {
            'symbol-placement': 'line-center',
            'text-field': ['to-string', ['get', 'VEHS']],
            'text-size': 11,
            'text-anchor': 'center',
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': 'rgba(255, 255, 255, 1)',
            'text-halo-color': 'rgba(0, 0, 0, 0.8)',
            'text-halo-width': 2,
          },
        });
        
        console.log('✅ Movement arrows and labels added');
      } catch (err) {
        console.error(err);
      }
    });

    return () => map.remove();
  }, []);

  // Filter movements when time interval changes
  useEffect(() => {
    if (!mapRef.current || !allMovements) return;

    const map = mapRef.current;
    const source = map.getSource('movements');
    if (!source) return;

    let filteredMovements;
    if (selectedTimeInt === 'all') {
      // Only show aggregated features with TIMEINT === 'all'
      filteredMovements = {
        type: 'FeatureCollection',
        features: allMovements.features.filter(
          f => f.properties.TIMEINT === 'all'
        ),
      };
    } else {
      // Show only the selected time interval
      filteredMovements = {
        type: 'FeatureCollection',
        features: allMovements.features.filter(
          f => f.properties.TIMEINT === selectedTimeInt
        ),
      };
    }

    console.log(`Filtering to ${selectedTimeInt}: ${filteredMovements.features.length} movements`);
    source.setData(filteredMovements);
  }, [selectedTimeInt, allMovements]);

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      
      {/* Time Interval Filter Buttons */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        background: 'white',
        padding: '15px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        maxWidth: '300px',
        zIndex: 1
      }}>
        <img 
          src="/data/Clarity_Logo_black.png" 
          alt="Clarity Logo" 
          style={{ 
            width: '100%', 
            maxWidth: '200px', 
            marginBottom: '15px',
            display: 'block',
            borderBottom: '1px solid rgba(14, 10, 10, 1)',
          }} 
        />
        <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 'bold' }}>
          Time Interval
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            onClick={() => setSelectedTimeInt('all')}
            style={{
              padding: '8px 12px',
              background: selectedTimeInt === 'all' ? '#3b82f6' : 'white',
              color: selectedTimeInt === 'all' ? 'white' : '#333',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: selectedTimeInt === 'all' ? 'bold' : 'normal',
              transition: 'all 0.2s'
            }}
          >
            All Time Intervals
          </button>
          {timeIntervals.map(timeInt => (
            <button
              key={timeInt.original}
              onClick={() => setSelectedTimeInt(timeInt.original)}
              style={{
                padding: '8px 12px',
                background: selectedTimeInt === timeInt.original ? '#3b82f6' : 'white',
                color: selectedTimeInt === timeInt.original ? 'white' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: selectedTimeInt === timeInt.original ? 'bold' : 'normal',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                if (selectedTimeInt !== timeInt.original) {
                  e.target.style.background = '#f3f4f6';
                }
              }}
              onMouseLeave={(e) => {
                if (selectedTimeInt !== timeInt.original) {
                  e.target.style.background = 'white';
                }
              }}
            >
              {timeInt.display}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProjectsMap;