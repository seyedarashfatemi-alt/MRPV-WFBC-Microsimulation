import { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken =
  'pk.eyJ1IjoiYXJhc2hjYyIsImEiOiJjbWhqeDFicjIxaHoyMmtxM3A1anphZG5vIn0.Hc43_oK4F3uS1k-LASpBMg';

const ProjectsMap = () => {
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const baseMapLayersRef = useRef([]);
  const customLayersDataRef = useRef({ links: null, movements: null });
  const originalStyleRef = useRef('mapbox://styles/arashcc/cmhjx3one00fj01si1cik0fas');
  const [linksGeoJSON, setLinksGeoJSON] = useState(null);
  const [allMovements, setAllMovements] = useState(null);
  const [timeIntervals, setTimeIntervals] = useState([]);
  const [selectedTimeInt, setSelectedTimeInt] = useState('all');
  const [showBaseMap, setShowBaseMap] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedMovements, setSelectedMovements] = useState([]);
  const [timePeriod, setTimePeriod] = useState('AM');
  const [isLoadingData, setIsLoadingData] = useState(false);

  useEffect(() => {
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/arashcc/cmhjx3one00fj01si1cik0fas',
      center: [144.65, -37.74],
      zoom: 12,
    });

    mapRef.current = map;

    map.once('style.load', () => {
      try {
        const style = map.getStyle();
        if (style && style.layers && baseMapLayersRef.current.length === 0) {
          baseMapLayersRef.current = style.layers.map(layer => layer.id);
          console.log('Base map layers captured:', baseMapLayersRef.current.length);
        }
      } catch (error) {
        console.warn('Could not capture base layers:', error);
      }
    });

    map.on('load', async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        if (baseMapLayersRef.current.length === 0) {
          const style = map.getStyle();
          if (style && style.layers) {
            baseMapLayersRef.current = style.layers.map(layer => layer.id);
            console.log('Base map layers stored on load:', baseMapLayersRef.current.length);
          }
        }

        const resLinks = await fetch('data/Links_Opt3.geojson');
        if (!resLinks.ok) throw new Error('Links_Opt3.geojson not found');

        const linksData = await resLinks.json();
        setLinksGeoJSON(linksData);

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

        const fileName = timePeriod === 'AM' ? 'data/Node_AM.txt' : 'data/Node_PM.txt';
        const resMov = await fetch(fileName);
        if (!resMov.ok) throw new Error(`${fileName} not found`);
        const text = await resMov.text();
        const allRows = text.split('\n');
        
        // Skip header row and filter out empty rows
        const rows = allRows.slice(1).filter(row => row.trim() && !row.includes('TIMEINT'));

        console.log(`📄 Total rows in ${fileName}:`, rows.length);

        const movementFeatures = [];
        const uniqueTimeIntervals = new Set();

        rows.forEach((row, index) => {
          if (!row.trim()) return;
          const cols = row.split('\t');
          
          // Skip if this looks like a header row
          if (cols[1] && cols[1].trim() === 'TIMEINT') return;
          
          if (cols.length < 7) return;

          const timeInt = cols[1].trim();
          const fromLink = cols[3].trim();
          const toLink = cols[4].trim();
          const vehs = parseFloat(cols[5]) || 0;
          
          // Skip if timeInt is not in the expected format (numbers with hyphen)
          if (!timeInt.match(/^\d+-\d+$/)) {
            console.warn('Skipping invalid time interval format:', timeInt);
            return;
          }

          uniqueTimeIntervals.add(timeInt);

          const fromFeature = linksData.features.find(
            f => String(f.properties['$LINK:NO']).trim() === fromLink
          );
          const toFeature = linksData.features.find(
            f => String(f.properties['$LINK:NO']).trim() === toLink
          );

          if (!fromFeature || !toFeature) {
            return;
          }

          const fromCoords = fromFeature.geometry.coordinates;
          const fromEnd = fromCoords[fromCoords.length - 1];
          
          const toCoords = toFeature.geometry.coordinates;
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
            const fromAngle = Math.atan2(fromDir.y, fromDir.x);
            const toAngle = Math.atan2(toDir.y, toDir.x);
            
            let angleDiff = ((toAngle - fromAngle) * 180 / Math.PI);
            
            while (angleDiff > 180) angleDiff -= 360;
            while (angleDiff < -180) angleDiff += 360;
            
            if (index < 5) {
              console.log(`Movement ${index + 1}: fromLink=${fromLink}, toLink=${toLink}, angle=${angleDiff.toFixed(1)}°`);
            }
            
            if (angleDiff >= -22.5 && angleDiff <= 22.5) {
              turnType = 'through';
            } else if (angleDiff > 22.5 && angleDiff <= 157.5) {
              turnType = 'left';
            } else if (angleDiff < -22.5 && angleDiff >= -157.5) {
              turnType = 'right';
            } else {
              turnType = 'uturn';
            }
          }

          const createCurvedLine = (start, end, segments = 20) => {
            const coords = [];
            const dx = end[0] - start[0];
            const dy = end[1] - start[1];
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (turnType === 'through') {
              for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                coords.push([
                  start[0] + t * dx,
                  start[1] + t * dy
                ]);
              }
            } else {
              const midX = (start[0] + end[0]) / 2;
              const midY = (start[1] + end[1]) / 2;
              
              let offset = distance * 0.2;
              
              if (turnType === 'uturn') {
                offset = distance * 0.35;
              }
              
              if (turnType === 'right') {
                offset = -offset;
              }
              
              const controlX = midX + (dy / distance) * offset;
              const controlY = midY - (dx / distance) * offset;
              
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

        const aggregatedMap = new Map();
        
        movementFeatures.forEach(feature => {
          const coords = feature.geometry.coordinates;
          const startCoord = coords[0];
          const endCoord = coords[coords.length - 1];
          const key = `${startCoord[0]},${startCoord[1]}-${endCoord[0]},${endCoord[1]}-${feature.properties.TURNTYPE}`;
          
          if (aggregatedMap.has(key)) {
            const existing = aggregatedMap.get(key);
            existing.properties.VEHS += feature.properties.VEHS;
          } else {
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
        
        const aggregatedFeatures = Array.from(aggregatedMap.values());
        console.log('Aggregated features for "all":', aggregatedFeatures.length);
        
        const allFeaturesWithAggregated = [...movementFeatures, ...aggregatedFeatures];

        const movements = {
          type: 'FeatureCollection',
          features: allFeaturesWithAggregated,
        };
        
        setAllMovements(movements);
        
        const initialFilteredMovements = {
          type: 'FeatureCollection',
          features: aggregatedFeatures,
        };
        
        customLayersDataRef.current = {
          links: linksData,
          movements: initialFilteredMovements
        };
        
        const convertSecondsToTimeLabel = (interval) => {
          const parts = interval.split('-');
          const startSec = parseInt(parts[0]);
          const endSec = parseInt(parts[1]);
          
          // Check for invalid data
          if (isNaN(startSec) || isNaN(endSec)) {
            console.warn('Invalid time interval:', interval);
            return interval; // Return original if can't parse
          }
          
          const hourOffset = timePeriod === 'AM' ? 4 : 13;
          const startHour = (startSec / 3600) + hourOffset;
          const endHour = (endSec / 3600) + hourOffset;
          
          const formatHour = (hour) => {
            if (isNaN(hour)) return 'N/A';
            if (hour === 0 || hour === 24) return '12am';
            if (hour < 12) return `${Math.floor(hour)}am`;
            if (hour === 12) return '12pm';
            return `${Math.floor(hour - 12)}pm`;
          };
          
          return `${formatHour(startHour)}-${formatHour(endHour)}`;
        };
        
        const intervalsWithLabels = Array.from(uniqueTimeIntervals).map(interval => ({
          original: interval,
          display: convertSecondsToTimeLabel(interval),
          startSeconds: parseInt(interval.split('-')[0])
        }));
        
        intervalsWithLabels.sort((a, b) => a.startSeconds - b.startSeconds);
        
        setTimeIntervals(intervalsWithLabels);
        console.log('Time intervals converted:', intervalsWithLabels);

        const initialMovements = {
          type: 'FeatureCollection',
          features: aggregatedFeatures,
        };
        
        console.log('Initial movements to display:', initialMovements.features.length);
        
        map.addSource('movements', { type: 'geojson', data: initialMovements });

        map.addLayer({
          id: 'movement-lines',
          type: 'line',
          source: 'movements',
          paint: {
            'line-color': [
              'match',
              ['get', 'TURNTYPE'],
              'left', 'rgba(0, 120, 255, 0.7)',
              'right', 'rgba(255, 165, 0, 0.7)',
              'uturn', 'rgba(200, 0, 200, 0)',
              'rgba(0, 200, 0, 0.7)'
            ],
            'line-width': [
              'interpolate',
              ['linear'],
              ['get', 'VEHS'],
              0, 2,
              500, 4,
              1000, 6,
              2000, 8
            ],
          },
        });

        const loadArrowImages = async () => {
          const arrowTypes = ['left', 'through', 'right', 'uturn'];
          
          for (const type of arrowTypes) {
            try {
              const response = await fetch(`arrows/arrow-${type}.svg`);
              if (!response.ok) {
                console.warn(`Could not load arrow-${type}.svg, using fallback`);
                continue;
              }
              const svgText = await response.text();
              
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
              'arrow-through'
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
        
        map.addLayer({
          id: 'movement-labels',
          type: 'symbol',
          source: 'movements',
          layout: {
            'symbol-placement': 'line-center',
            'text-field': ['to-string', ['get', 'VEHS']],
            'text-size': 14,
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
        
        setTimeout(() => {
          if (map.getLayer('movement-labels')) {
            map.on('click', 'movement-labels', (e) => {
              console.log('Label clicked!', e.features[0]);
              if (e.features.length > 0) {
                const feature = e.features[0];
                const clickedCoords = feature.geometry.coordinates;
                
                const movementId = `${clickedCoords[0][0]},${clickedCoords[0][1]}-${clickedCoords[clickedCoords.length-1][0]},${clickedCoords[clickedCoords.length-1][1]}-${feature.properties.TURNTYPE}`;
                
                setSelectedMovements(prev => {
                  const exists = prev.find(m => m.id === movementId);
                  
                  if (exists) {
                    return prev.filter(m => m.id !== movementId);
                  } else {
                    const matchingMovements = movements.features.filter(f => {
                      const fCoords = f.geometry.coordinates;
                      const startMatch = Math.abs(fCoords[0][0] - clickedCoords[0][0]) < 0.00001 &&
                                        Math.abs(fCoords[0][1] - clickedCoords[0][1]) < 0.00001;
                      const endMatch = Math.abs(fCoords[fCoords.length-1][0] - clickedCoords[clickedCoords.length-1][0]) < 0.00001 &&
                                      Math.abs(fCoords[fCoords.length-1][1] - clickedCoords[clickedCoords.length-1][1]) < 0.00001;
                      return startMatch && endMatch && f.properties.TURNTYPE === feature.properties.TURNTYPE && f.properties.TIMEINT !== 'all';
                    });
                    
                    const timeData = matchingMovements
                      .map(f => ({
                        timeInt: f.properties.TIMEINT,
                        vehs: f.properties.VEHS,
                        turnType: f.properties.TURNTYPE
                      }))
                      .sort((a, b) => {
                        const aStart = parseInt(a.timeInt.split('-')[0]);
                        const bStart = parseInt(b.timeInt.split('-')[0]);
                        return aStart - bStart;
                      });
                    
                    return [...prev, {
                      id: movementId,
                      properties: feature.properties,
                      timeData: timeData
                    }];
                  }
                });
              }
            });
            
            map.on('mouseenter', 'movement-labels', () => {
              map.getCanvas().style.cursor = 'pointer';
            });
            
            map.on('mouseleave', 'movement-labels', () => {
              map.getCanvas().style.cursor = '';
            });
            
            console.log('✅ Click handlers added to movement-labels');
          }
        }, 500);
        
        setMapLoaded(true);
      } catch (err) {
        console.error(err);
      }
    });

    return () => map.remove();
  }, [timePeriod]);

  useEffect(() => {
    if (!mapRef.current || !allMovements) return;

    const map = mapRef.current;
    const source = map.getSource('movements');
    if (!source) return;

    let filteredMovements;
    if (selectedTimeInt === 'all') {
      filteredMovements = {
        type: 'FeatureCollection',
        features: allMovements.features.filter(
          f => f.properties.TIMEINT === 'all'
        ),
      };
    } else {
      filteredMovements = {
        type: 'FeatureCollection',
        features: allMovements.features.filter(
          f => f.properties.TIMEINT === selectedTimeInt
        ),
      };
    }

    console.log(`Filtering to ${selectedTimeInt}: ${filteredMovements.features.length} movements`);
    source.setData(filteredMovements);
    
    customLayersDataRef.current.movements = filteredMovements;
    
    if (map.getLayer('movement-labels')) {
      map.off('click', 'movement-labels');
      
      map.on('click', 'movement-labels', (e) => {
        if (e.features.length > 0) {
          const feature = e.features[0];
          const clickedCoords = feature.geometry.coordinates;
          
          const movementId = `${clickedCoords[0][0]},${clickedCoords[0][1]}-${clickedCoords[clickedCoords.length-1][0]},${clickedCoords[clickedCoords.length-1][1]}-${feature.properties.TURNTYPE}`;
          
          setSelectedMovements(prev => {
            const exists = prev.find(m => m.id === movementId);
            
            if (exists) {
              return prev.filter(m => m.id !== movementId);
            } else {
              const matchingMovements = allMovements.features.filter(f => {
                const fCoords = f.geometry.coordinates;
                const startMatch = Math.abs(fCoords[0][0] - clickedCoords[0][0]) < 0.00001 &&
                                  Math.abs(fCoords[0][1] - clickedCoords[0][1]) < 0.00001;
                const endMatch = Math.abs(fCoords[fCoords.length-1][0] - clickedCoords[clickedCoords.length-1][0]) < 0.00001 &&
                                Math.abs(fCoords[fCoords.length-1][1] - clickedCoords[clickedCoords.length-1][1]) < 0.00001;
                return startMatch && endMatch && f.properties.TURNTYPE === feature.properties.TURNTYPE && f.properties.TIMEINT !== 'all';
              });
              
              const timeData = matchingMovements
                .map(f => ({
                  timeInt: f.properties.TIMEINT,
                  vehs: f.properties.VEHS,
                  turnType: f.properties.TURNTYPE
                }))
                .sort((a, b) => {
                  const aStart = parseInt(a.timeInt.split('-')[0]);
                  const bStart = parseInt(b.timeInt.split('-')[0]);
                  return aStart - bStart;
                });
              
              return [...prev, {
                id: movementId,
                properties: feature.properties,
                timeData: timeData
              }];
            }
          });
        }
      });
    }
  }, [selectedTimeInt, allMovements]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    
    const map = mapRef.current;
    
    // Wait for style to be fully loaded before switching
    if (!map.isStyleLoaded()) {
      console.log('Style not loaded yet, waiting...');
      map.once('idle', () => {
        // Retry after map is idle
        if (showBaseMap !== (map.getStyle().name !== undefined)) {
          toggleBaseMap();
        }
      });
      return;
    }
    
    console.log('Toggling base map:', showBaseMap);
    
    const toggleBaseMap = () => {
    
    const addCustomLayers = (useBlackLabels = false) => {
      const { links, movements } = customLayersDataRef.current;
      
      if (links) {
        if (!map.getSource('links')) {
          map.addSource('links', { type: 'geojson', data: links });
        }
        if (!map.getLayer('links-line')) {
          map.addLayer({
            id: 'links-line',
            type: 'line',
            source: 'links',
            paint: {
              'line-color': 'rgba(0, 0, 0, 1)',
              'line-width': 2,
            },
          });
        }
      }
      
      if (movements) {
        if (!map.getSource('movements')) {
          map.addSource('movements', { type: 'geojson', data: movements });
        }
        
        if (!map.getLayer('movement-lines')) {
          map.addLayer({
            id: 'movement-lines',
            type: 'line',
            source: 'movements',
            paint: {
              'line-color': [
                'match',
                ['get', 'TURNTYPE'],
                'left', 'rgba(0, 120, 255, 0.7)',
                'right', 'rgba(255, 165, 0, 0.7)',
                'uturn', 'rgba(200, 0, 200, 0)',
                'rgba(0, 200, 0, 0.7)'
              ],
              'line-width': [
                'interpolate',
                ['linear'],
                ['get', 'VEHS'],
                0, 2,
                500, 4,
                1000, 6,
                2000, 8
              ],
            },
          });
        }
        
        const loadArrowImages = async () => {
          const arrowTypes = ['left', 'through', 'right', 'uturn'];
          
          for (const type of arrowTypes) {
            try {
              if (map.hasImage(`arrow-${type}`)) continue;
              
              const response = await fetch(`arrows/arrow-${type}.svg`);
              if (!response.ok) continue;
              const svgText = await response.text();
              
              const img = new Image(32, 32);
              await new Promise((resolve, reject) => {
                img.onload = () => {
                  map.addImage(`arrow-${type}`, img);
                  resolve();
                };
                img.onerror = reject;
                img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
              });
            } catch (error) {
              console.error(`Error loading arrow-${type}:`, error);
            }
          }
        };
        
        loadArrowImages().then(() => {
          if (!map.getLayer('movement-arrowheads')) {
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
                  'arrow-through'
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
          }
          
          if (!map.getLayer('movement-labels')) {
            map.addLayer({
              id: 'movement-labels',
              type: 'symbol',
              source: 'movements',
              layout: {
                'symbol-placement': 'line-center',
                'text-field': ['to-string', ['get', 'VEHS']],
                'text-size': 14,
                'text-anchor': 'center',
                'text-allow-overlap': true,
              },
              paint: {
                'text-color': useBlackLabels ? 'rgba(0, 0, 0, 1)' : 'rgba(255, 255, 255, 1)',
                'text-halo-color': useBlackLabels ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)',
                'text-halo-width': 2,
              },
            });
            
            setTimeout(() => {
              map.on('click', 'movement-labels', (e) => {
                console.log('Label clicked in addCustomLayers!', e.features[0]);
                if (e.features.length > 0) {
                  const feature = e.features[0];
                  const clickedCoords = feature.geometry.coordinates;
                  
                  const movementId = `${clickedCoords[0][0]},${clickedCoords[0][1]}-${clickedCoords[clickedCoords.length-1][0]},${clickedCoords[clickedCoords.length-1][1]}-${feature.properties.TURNTYPE}`;
                  
                  setSelectedMovements(prev => {
                    const exists = prev.find(m => m.id === movementId);
                    
                    if (exists) {
                      return prev.filter(m => m.id !== movementId);
                    } else {
                      const matchingMovements = customLayersDataRef.current.movements.features.filter(f => {
                        const fCoords = f.geometry.coordinates;
                        const startMatch = Math.abs(fCoords[0][0] - clickedCoords[0][0]) < 0.00001 &&
                                          Math.abs(fCoords[0][1] - clickedCoords[0][1]) < 0.00001;
                        const endMatch = Math.abs(fCoords[fCoords.length-1][0] - clickedCoords[clickedCoords.length-1][0]) < 0.00001 &&
                                        Math.abs(fCoords[fCoords.length-1][1] - clickedCoords[clickedCoords.length-1][1]) < 0.00001;
                        return startMatch && endMatch && f.properties.TURNTYPE === feature.properties.TURNTYPE;
                      });
                      
                      const timeData = matchingMovements
                        .map(f => ({
                          timeInt: f.properties.TIMEINT,
                          vehs: f.properties.VEHS,
                          turnType: f.properties.TURNTYPE
                        }))
                        .sort((a, b) => {
                          const aStart = parseInt(a.timeInt.split('-')[0]);
                          const bStart = parseInt(b.timeInt.split('-')[0]);
                          return aStart - bStart;
                        });
                      
                      return [...prev, {
                        id: movementId,
                        properties: feature.properties,
                        timeData: timeData
                      }];
                    }
                  });
                }
              });
              
              map.on('mouseenter', 'movement-labels', () => {
                map.getCanvas().style.cursor = 'pointer';
              });
              
              map.on('mouseleave', 'movement-labels', () => {
                map.getCanvas().style.cursor = '';
              });
            }, 300);
          }
          
          console.log('✅ Custom layers added');
        });
      }
    };
    
      if (!showBaseMap) {
        console.log('Switching to blank style...');
        
        const blankStyle = {
          version: 8,
          sources: {},
          layers: [
            {
              id: 'background',
              type: 'background',
              paint: {
                'background-color': '#ffffff'
              }
            }
          ]
        };
        
        map.setStyle(blankStyle);
        
        map.once('style.load', () => {
          console.log('Blank style loaded, re-adding custom layers...');
          addCustomLayers(true);
        });
        
      } else {
        console.log('Switching back to original style...');
        map.setStyle(originalStyleRef.current);
        
        map.once('style.load', () => {
          console.log('Original style loaded, re-adding custom layers...');
          addCustomLayers(false);
        });
      }
    };
    
    toggleBaseMap();
    
  }, [showBaseMap, mapLoaded]);

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      
      <div style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        zIndex: 1
      }}>
        <div style={{
          background: 'white',
          padding: '12px 15px',
          borderRadius: '8px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        }}>
          <h3 style={{ 
            margin: '0 0 10px 0', 
            fontSize: '14px', 
            fontWeight: 'bold',
            color: '#333'
          }}>
            Peak Period
          </h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setTimePeriod('AM')}
              style={{
                padding: '8px 16px',
                background: timePeriod === 'AM' ? '#3b82f6' : 'white',
                color: timePeriod === 'AM' ? 'white' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: timePeriod === 'AM' ? 'bold' : 'normal',
                transition: 'all 0.2s',
                flex: 1
              }}
            >
              AM Peak
            </button>
            <button
              onClick={() => setTimePeriod('PM')}
              style={{
                padding: '8px 16px',
                background: timePeriod === 'PM' ? '#3b82f6' : 'white',
                color: timePeriod === 'PM' ? 'white' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: timePeriod === 'PM' ? 'bold' : 'normal',
                transition: 'all 0.2s',
                flex: 1
              }}
            >
              PM Peak
            </button>
          </div>
        </div>
        
        <div style={{
          background: 'white',
          padding: '15px',
          borderRadius: '8px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
          minWidth: '180px'
        }}>
          <h3 style={{ 
            margin: '0 0 12px 0', 
            fontSize: '16px', 
            fontWeight: 'bold',
            borderBottom: '1px solid #ddd',
            paddingBottom: '8px'
          }}>
            Turn Types
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ 
                width: '30px', 
                height: '3px', 
                backgroundColor: 'rgba(0, 120, 255, 0.7)',
                borderRadius: '2px'
              }}></div>
              <span style={{ fontSize: '14px' }}>Left Turn</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ 
                width: '30px', 
                height: '3px', 
                backgroundColor: 'rgba(0, 200, 0, 0.7)',
                borderRadius: '2px'
              }}></div>
              <span style={{ fontSize: '14px' }}>Through</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ 
                width: '30px', 
                height: '3px', 
                backgroundColor: 'rgba(255, 165, 0, 0.7)',
                borderRadius: '2px'
              }}></div>
              <span style={{ fontSize: '14px' }}>Right Turn</span>
            </div>
          </div>
        </div>
      </div>
      
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
        <div style={{
          fontSize: '24px',
          fontWeight: 'bold',
          marginBottom: '15px',
          paddingBottom: '15px',
          borderBottom: '2px solid #000',
          letterSpacing: '2px'
        }}>
          CLARITY
        </div>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 'bold', borderBottom: '1px solid rgba(14, 10, 10, 1)', paddingBottom: '10px' }}>
          2036 Option 3 - {timePeriod} Hourly Demand
        </h3>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 'bold' }}>
          Time Intervals
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
      
      {selectedMovements.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          maxWidth: '800px',
          maxHeight: '500px',
          overflowY: 'auto',
          zIndex: 1000
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '15px',
            borderBottom: '2px solid #3b82f6',
            paddingBottom: '10px'
          }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>
              Selected Movements ({selectedMovements.length})
            </h3>
            <button
              onClick={() => setSelectedMovements([])}
              style={{
                background: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold'
              }}
            >
              Clear All
            </button>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {selectedMovements.map((movement, idx) => (
              <div key={movement.id} style={{
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                padding: '15px',
                background: '#f9fafb'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px'
                }}>
                  <h4 style={{ 
                    margin: 0, 
                    fontSize: '16px', 
                    fontWeight: 'bold',
                    color: '#1f2937'
                  }}>
                    Movement {idx + 1}: {movement.properties.TURNTYPE.charAt(0).toUpperCase() + movement.properties.TURNTYPE.slice(1)} Turn
                  </h4>
                  <button
                    onClick={() => setSelectedMovements(prev => prev.filter(m => m.id !== movement.id))}
                    style={{
                      background: '#6b7280',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Remove
                  </button>
                </div>
                
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '13px',
                  background: 'white'
                }}>
                  <thead>
                    <tr style={{ 
                      background: '#f3f4f6',
                      borderBottom: '2px solid #ddd'
                    }}>
                      <th style={{ 
                        padding: '8px',
                        textAlign: 'left',
                        fontWeight: 'bold'
                      }}>Time Interval</th>
                      <th style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        fontWeight: 'bold'
                      }}>Vehicles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movement.timeData.map((data, index) => {
                      const convertSecondsToTimeLabel = (interval) => {
                        const parts = interval.split('-');
                        const startSec = parseInt(parts[0]);
                        const endSec = parseInt(parts[1]);
                        
                        // Check for invalid data
                        if (isNaN(startSec) || isNaN(endSec)) {
                          console.warn('Invalid time interval in table:', interval);
                          return interval;
                        }
                        
                        const hourOffset = timePeriod === 'AM' ? 4 : 13;
                        const startHour = (startSec / 3600) + hourOffset;
                        const endHour = (endSec / 3600) + hourOffset;
                        
                        const formatHour = (hour) => {
                          if (isNaN(hour)) return 'N/A';
                          if (hour === 0 || hour === 24) return '12am';
                          if (hour < 12) return `${Math.floor(hour)}am`;
                          if (hour === 12) return '12pm';
                          return `${Math.floor(hour - 12)}pm`;
                        };
                        
                        return `${formatHour(startHour)}-${formatHour(endHour)}`;
                      };
                      
                      return (
                        <tr key={index} style={{
                          borderBottom: '1px solid #e5e7eb',
                          background: index % 2 === 0 ? 'white' : '#f9fafb'
                        }}>
                          <td style={{ padding: '8px' }}>
                            {convertSecondsToTimeLabel(data.timeInt)}
                          </td>
                          <td style={{ 
                            padding: '8px',
                            textAlign: 'right',
                            fontWeight: '500'
                          }}>
                            {Math.round(data.vehs)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{
                      borderTop: '2px solid #3b82f6',
                      background: '#eff6ff',
                      fontWeight: 'bold'
                    }}>
                      <td style={{ padding: '8px' }}>Total</td>
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right'
                      }}>
                        {Math.round(movement.timeData.reduce((sum, d) => sum + d.vehs, 0))}
                      </td>
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