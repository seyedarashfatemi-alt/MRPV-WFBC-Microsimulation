import { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken =
  'pk.eyJ1IjoiYXJhc2hjYyIsImEiOiJjbWhqeDFicjIxaHoyMmtxM3A1anphZG5vIn0.Hc43_oK4F3uS1k-LASpBMg';

const ProjectsMap = ({ onLogout, userEmail }) => {
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const customLayersDataRef = useRef({ links: null, movements: null });
  const nodeMarkersRef = useRef([]);
  const lastZoomRef = useRef(null);
  const [linksGeoJSON, setLinksGeoJSON] = useState(null);
  const [allMovements, setAllMovements] = useState(null);
  const [timeIntervals, setTimeIntervals] = useState([]);
  const [selectedTimeInt, setSelectedTimeInt] = useState('all');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedMovements, setSelectedMovements] = useState([]);
  const [timePeriod, setTimePeriod] = useState('AM');
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [showColoredTurns, setShowColoredTurns] = useState(false); // Toggle for colored turn lines and labels
  const BASE_URL = import.meta.env.BASE_URL; // Add this line

  const clearNodeMarkers = () => {
    const count = nodeMarkersRef.current.length;
    nodeMarkersRef.current.forEach(m => m.remove());
    nodeMarkersRef.current = [];
    if (count > 0) {
      console.log(`🗑️ Cleared ${count} marker(s)`);
    }
  };

  const buildTurnBoxElement = ({ left = 0, through = 0, throughs = null, right = 0, rotationAngle = null }) => {
    const root = document.createElement('div');
    root.style.background = 'rgba(255,255,255,0.95)';
    root.style.border = '1px solid rgba(0,0,0,0.25)';
    root.style.borderRadius = '4px';
    root.style.padding = '4px 4px';
    root.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    root.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
    root.style.fontSize = '10px';
    root.style.lineHeight = '1.2';
    root.style.color = '#111';
    root.style.pointerEvents = 'none';
    root.style.display = 'flex';
    root.style.flexDirection = 'row';
    root.style.gap = '3px';
    root.style.alignItems = 'flex-start';
    
    // Rotate the box to align with the "from link" direction
    if (rotationAngle !== null && rotationAngle !== undefined) {
      // fromAngle (rotationAngle) is the direction the link is traveling (toward the node) in radians
      // Map coordinate system: 0 = east, π/2 = north, -π/2 = south, π = west (counterclockwise from east)
      // We want the box to align with the approach direction (where traffic comes FROM)
      // This is the opposite of fromAngle, so add 180° (π radians)
      const approachAngleRad = rotationAngle + Math.PI;
      
      // Convert to degrees
      let approachAngleDeg = approachAngleRad * 180 / Math.PI;
      
      // Normalize to 0-360 range for easier calculation
      while (approachAngleDeg < 0) approachAngleDeg += 360;
      while (approachAngleDeg >= 360) approachAngleDeg -= 360;
      
      // CSS rotation: 0° = no rotation (up), 90° = right, 180° = down, 270° = left (clockwise)
      // Map: 0° = east, 90° = north, 180° = west, 270° = south (counterclockwise)
      // Convert map angle to CSS: CSS 0° (up) = map 90° (north), so: cssAngle = 90° - mapAngle
      // But since map is counterclockwise and CSS is clockwise, we negate: cssAngle = -(90° - mapAngle) = mapAngle - 90°
      let cssApproachAngle = approachAngleDeg - 90;
      
      // Normalize CSS angle
      while (cssApproachAngle < 0) cssApproachAngle += 360;
      while (cssApproachAngle >= 360) cssApproachAngle -= 360;
      
      // Our arrow points DOWN (180° in CSS), so we need to rotate so DOWN aligns with approach direction
      // If approach is north (0° in CSS), we want down (180°) to point north, so rotate by -180° (or +180°)
      // If approach is east (90° in CSS), we want down (180°) to point east, so rotate by -90° (or +270°)
      // Formula: cssAngle = cssApproachAngle - 180
      let cssAngle = cssApproachAngle - 180;
      
      // Normalize to -180 to 180 for CSS
      while (cssAngle > 180) cssAngle -= 360;
      while (cssAngle < -180) cssAngle += 360;
      
      console.log(`Rotating box: fromAngle=${(rotationAngle * 180 / Math.PI).toFixed(1)}°, approachAngle=${approachAngleDeg.toFixed(1)}°, cssApproachAngle=${cssApproachAngle.toFixed(1)}°, cssAngle=${cssAngle.toFixed(1)}°`);
      
      // Apply transform - use setProperty correctly for important
      root.style.setProperty('transform', `rotate(${cssAngle}deg)`, 'important');
      root.style.setProperty('transform-origin', 'center center', 'important');
      // Also set directly as fallback
      root.style.transform = `rotate(${cssAngle}deg)`;
      root.style.transformOrigin = 'center center';
    }
    // Note: rotationAngle can be null when we're rotating a wrapper instead

    const row = (labelSvg, value, addDivider) => {
      const r = document.createElement('div');
      r.style.display = 'flex';
      r.style.flexDirection = 'column';
      r.style.alignItems = 'center';
      r.style.gap = '2px';
      r.style.margin = '2px 0';
      if (addDivider) {
        r.style.borderRight = '1px solid #d0d0d0';
        r.style.paddingRight = '6px';
        r.style.marginRight = '6px';
      }

      const iconWrap = document.createElement('div');
      iconWrap.innerHTML = labelSvg;
      iconWrap.style.display = 'flex';
      iconWrap.style.justifyContent = 'center';

      const val = document.createElement('div');
      // Format number with comma separator for thousands
      const formattedValue = Math.round(value).toLocaleString('en-US');
      val.textContent = formattedValue;
      val.style.textAlign = 'center';
      val.style.fontWeight = '500';
      val.style.fontSize = '12px';

      r.appendChild(iconWrap);
      r.appendChild(val);
      return r;
    };

    const BLUE = '#0b57d0';
    // Create filled (solid) arrow paths - smaller size for compact box
    const svgFilled = (d) =>
      `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <path d="${d}" fill="${BLUE}"/>
      </svg>`;

    // Arrow glyphs: all flipped upside down (pointing down) and matching through arrow style
    // Straight/Through: thick vertical arrow pointing down (flipped)
    // Body width: 4px (from x=10 to x=14), height: 14px (from y=22 to y=8)
    // Arrowhead: triangle pointing down
    const THROUGH = svgFilled('M10 22 L14 22 L14 8 L18 8 L12 2 L6 8 L10 8 Z');
    
    // Left turn: arrow pointing left with L-shaped tail
    // Arrowhead pointing left, L-shaped tail extends right then down
    // Horizontal part: from arrowhead (x=8) to right edge (x=24), height 4px (y=10-14)
    // Vertical part: extends down from right edge (L-shape)
    const LEFT = svgFilled('M24 10 L24 14 L8 14 L8 18 L0 12 L8 6 L8 10 L24 10 L24 20 L20 20 L20 14 L24 14 Z');
    
    // Right turn: arrow pointing right with L-shaped tail
    // Arrowhead pointing right, L-shaped tail extends left then down
    // Horizontal part: from arrowhead (x=16) to left edge (x=0), height 4px (y=10-14)
    // Vertical part: extends down from left edge (L-shape)
    const RIGHT = svgFilled('M0 10 L0 14 L16 14 L16 18 L24 12 L16 6 L16 10 L0 10 L0 20 L4 20 L4 14 L0 14 Z');

    // Only show arrows when their values are greater than 0, add a thin divider between columns
    const cols = [];
    if (left > 0) cols.push({ svg: LEFT, val: left });

    // Special case: render two through movements in a single box (no summing)
    if (Array.isArray(throughs) && throughs.length === 2) {
      const [a, b] = throughs;
      // Always show both arrows, even if value is 0, to keep them visually separate
      cols.push({ svg: THROUGH, val: a, force: true });
      cols.push({ svg: THROUGH, val: b, force: true });
    } else {
      if (through > 0) cols.push({ svg: THROUGH, val: through });
    }

    if (right > 0) cols.push({ svg: RIGHT, val: right });

    cols.forEach((col, idx) => {
      const addDivider = idx < cols.length - 1;
      // If force is set, show even when val is 0; otherwise require val > 0 (already filtered)
      if (col.force || col.val > 0) {
        root.appendChild(row(col.svg, col.val, addDivider));
      }
    });

    return root;
  };

  const updateNodeMarkers = (movementFeatures) => {
    const map = mapRef.current;
    if (!map) {
      console.warn('⚠️ updateNodeMarkers: map is null');
      return;
    }

    // Avoid clutter at low zoom.
    const minZoom = 13;
    const currentZoom = map.getZoom();
    
    console.log(`🔄 updateNodeMarkers called: zoom=${currentZoom.toFixed(2)}, features=${movementFeatures?.length || 0}, existing markers=${nodeMarkersRef.current.length}`);
    
    // Always clear existing markers first
    clearNodeMarkers();
    
    // If below zoom threshold, don't create markers
    if (currentZoom < minZoom) {
      console.log(`⏸️ Zoom ${currentZoom.toFixed(2)} < ${minZoom}, skipping marker creation`);
      return;
    }
    
    console.log(`✅ Zoom ${currentZoom.toFixed(2)} >= ${minZoom}, creating markers...`);

    const agg = new Map();

    // Group by FROM_LINK instead of node - one box per "from link"
    // Also need access to links data to recalculate fromAngle if needed
    const linksData = customLayersDataRef.current?.links;
    
    movementFeatures.forEach(f => {
      const fromLink = f?.properties?.FROM_LINK;
      const fromLinkPos = f?.properties?.FROM_LINK_POS;
      const toLink = f?.properties?.TO_LINK;
      const tt = f.properties?.TURNTYPE;
      const v = Number(f.properties?.VEHS) || 0;
      
      if (!fromLink || !fromLinkPos || fromLinkPos.length < 2) return;
      if (tt === 'uturn') return; // Skip uturn

      // Always recalculate fromAngle from the link geometry in the links file
      // This ensures we're using the actual link direction, not a stored value
      let fromAngle = null;
      if (linksData) {
        const fromFeature = linksData.features.find(
          link => String(link.properties['$LINK:NO']).trim() === String(fromLink).trim()
        );
        if (fromFeature && fromFeature.geometry.coordinates.length >= 2) {
          const fromCoords = fromFeature.geometry.coordinates;
          // Calculate direction vector from the last two coordinates (toward the intersection)
          // This gives us the direction the link is traveling as it approaches the node
          const fromDir = {
            x: fromCoords[fromCoords.length - 1][0] - fromCoords[fromCoords.length - 2][0],
            y: fromCoords[fromCoords.length - 1][1] - fromCoords[fromCoords.length - 2][1]
          };
          // Calculate angle in radians (map coordinate system: 0 = east, π/2 = north, -π/2 = south)
          fromAngle = Math.atan2(fromDir.y, fromDir.x);
          
          // Debug: log first few to verify
          if (movementFeatures.indexOf(f) < 3) {
            const fromAngleDeg = fromAngle * 180 / Math.PI;
            console.log(`   🔍 fromLink ${fromLink}: calculated fromAngle=${fromAngleDeg.toFixed(1)}° from link geometry (${fromCoords.length} coords)`);
          }
        } else {
          console.warn(`   ⚠️ Could not find link ${fromLink} in links data`);
        }
      } else {
        console.warn(`   ⚠️ Links data not available for fromLink ${fromLink}`);
      }

      // For through movements: keep them separate by using FROM_LINK + TO_LINK as key
      // For left/right movements: aggregate by FROM_LINK only
      let k;
      if (tt === 'through' || (!tt || tt === '')) {
        // Through movements: separate by toLink to keep them individual
        k = `${fromLink}_through_${toLink || 'unknown'}`;
      } else {
        // Left/right movements: aggregate by fromLink only
        k = `${fromLink}_${tt}`;
      }
      
      if (!agg.has(k)) {
        agg.set(k, {
          fromLink: String(fromLink).trim(),
          position: fromLinkPos, // Use the end position of the from link
          fromAngle: fromAngle, // Store the rotation angle
          left: 0,
          through: 0,
          right: 0,
          toLink: toLink, // Store toLink for through movements
        });
      }
      
      const entry = agg.get(k);
      if (tt === 'left') entry.left += v;
      else if (tt === 'right') entry.right += v;
      else if (tt === 'through' || (!tt || tt === '')) {
        // For through movements, store the value directly (don't add - each is separate)
        entry.through = v;
      }
    });

    console.log(`📊 Aggregated ${agg.size} unique fromLinks`);
    
    // Helper function to create a marker
    const createMarker = (lng, lat, fromAngle, left, through, right, fromLink, offsetX = 0, offsetY = 0, throughs = null) => {
      // Calculate rotation angle
      let cssAngle = 0;
      if (fromAngle !== null && fromAngle !== undefined) {
        const approachAngleRad = fromAngle + Math.PI;
        const approachAngleDeg = approachAngleRad * 180 / Math.PI;
        cssAngle = 270 - approachAngleDeg;
        cssAngle = ((cssAngle + 180) % 360) - 180;
      }
      
      // Create wrapper
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `display: inline-block;`;
      
      // Build turn box element
      const el = buildTurnBoxElement({ left, through, throughs, right, rotationAngle: null });
      
      // Create rotation container
      const rotationContainer = document.createElement('div');
      rotationContainer.style.cssText = `
        display: inline-block;
        transform-origin: top center;
        will-change: transform;
      `;
      
      if (fromAngle !== null && fromAngle !== undefined) {
        rotationContainer.style.setProperty('transform', `rotate(${cssAngle}deg)`, 'important');
      }
      
      rotationContainer.appendChild(el);
      wrapper.appendChild(rotationContainer);
      
      // Calculate offset position if needed
      let finalLng = lng;
      let finalLat = lat;
      if (offsetX !== 0 || offsetY !== 0) {
        // Get current zoom level for accurate pixel-to-degree conversion
        const zoom = map.getZoom();
        // At zoom level, calculate meters per pixel
        const metersPerPixel = 40075017 / (256 * Math.pow(2, zoom));
        // Convert pixel offset to meters
        const offsetMetersX = offsetX * metersPerPixel;
        const offsetMetersY = offsetY * metersPerPixel;
        // Convert meters to degrees (approximate)
        const metersPerDegreeLat = 111320;
        const metersPerDegreeLng = 111320 * Math.cos(lat * Math.PI / 180);
        finalLng += offsetMetersX / metersPerDegreeLng;
        finalLat -= offsetMetersY / metersPerDegreeLat; // Negative because screen Y increases downward
      }
      
      const marker = new mapboxgl.Marker({ element: wrapper, anchor: 'top' })
        .setLngLat([finalLng, finalLat])
        .addTo(map);
      
      return marker;
    };
    
    // Group entries by fromLink to handle multiple through movements
    const byFromLink = new Map();
    agg.forEach((entry, key) => {
      const fromLink = entry.fromLink;
      if (!byFromLink.has(fromLink)) {
        byFromLink.set(fromLink, {
          position: entry.position,
          fromAngle: entry.fromAngle,
          left: 0,
          right: 0,
          throughMovements: [], // Array to store individual through movements
          throughTotal: 0, // Total for aggregation when not separating
        });
      }
      const group = byFromLink.get(fromLink);
      group.left += entry.left;
      group.right += entry.right;
      if (entry.through > 0) {
        group.throughMovements.push({ through: entry.through, toLink: entry.toLink });
        group.throughTotal += entry.through;
      }
    });
    
    // Create markers for each fromLink group
    byFromLink.forEach(({ position, fromAngle, left, right, throughMovements, throughTotal }, fromLink) => {
      console.log(`\n📍 Creating marker(s) for fromLink ${fromLink}:`);
      console.log(`   - Position (end of from link): [${position?.[0]?.toFixed(6)}, ${position?.[1]?.toFixed(6)}]`);
      console.log(`   - fromAngle: ${fromAngle} (${fromAngle ? (fromAngle * 180 / Math.PI).toFixed(1) + '°' : 'null'})`);
      console.log(`   - Counts: left=${left}, right=${right}, through movements=${throughMovements.length}, through total=${throughTotal}`);
      
      // Verify position is valid
      if (!position || position.length < 2 || isNaN(position[0]) || isNaN(position[1])) {
        console.error(`   ❌ Invalid position for fromLink ${fromLink}:`, position);
        return;
      }
      
      let [lng, lat] = position;
      if (typeof lng !== 'number' || typeof lat !== 'number' || isNaN(lng) || isNaN(lat)) {
        console.error(`   ❌ Invalid coordinates for fromLink ${fromLink}: lng=${lng}, lat=${lat}`);
        return;
      }
      
      const hasExactlyTwoThroughs = throughMovements.length === 2;
      
      if (hasExactlyTwoThroughs) {
        // Separate boxes for the two through movements.
        // If left/right exist, render them at the from-link position first.
        if (left > 0 || right > 0) {
          const lrMarker = createMarker(lng, lat, fromAngle, left, 0, right, fromLink, 0, 0);
          nodeMarkersRef.current.push(lrMarker);
          console.log(`   ✅ Created left/right box (left=${left}, right=${right})`);
        }

        const reversedMovements = [...throughMovements].reverse();
        reversedMovements.forEach((movement, index) => {
          let tLng = lng;
          let tLat = lat;

          // Place each through box at the START of its toLink if available
          if (linksData && movement.toLink) {
            const toFeature = linksData.features.find(
              link => String(link.properties['$LINK:NO']).trim() === String(movement.toLink).trim()
            );
            if (toFeature && Array.isArray(toFeature.geometry?.coordinates) && toFeature.geometry.coordinates.length > 0) {
              const startCoord = toFeature.geometry.coordinates[0];
              if (Array.isArray(startCoord) && startCoord.length >= 2) {
                tLng = startCoord[0];
                tLat = startCoord[1];
                console.log(`   📍 Through ${index + 1}: placing at start of toLink ${movement.toLink}: [${tLng.toFixed(6)}, ${tLat.toFixed(6)}]`);
              }
            }
          }

          const marker = createMarker(tLng, tLat, fromAngle, 0, movement.through, 0, fromLink, 0, 0);
          nodeMarkersRef.current.push(marker);
          console.log(`   ✅ Created through box ${index + 1} (through=${movement.through}, toLink=${movement.toLink})`);
        });
      } else {
        // Normal case: aggregate through movements together (original behavior)
        const marker = createMarker(lng, lat, fromAngle, left, throughTotal, right, fromLink, 0, 0);
        nodeMarkersRef.current.push(marker);
        console.log(`   ✅ Created single box (left=${left}, through=${throughTotal}, right=${right})`);
      }
    });
  };
  

  useEffect(() => {
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/arashcc/cmhjx3one00fj01si1cik0fas', // Custom style URL
      center: [144.65, -37.74],
      zoom: 12,
      attributionControl: false, // Disable attribution control (bottom-right)
    });

    mapRef.current = map;

    const handleZoomForTurnBoxes = () => {
      const currentZoom = map.getZoom();
      console.log(`\n🔍 ZOOM EVENT: zoom=${currentZoom.toFixed(2)}`);
      // Always update markers on zoom end - updateNodeMarkers handles the zoom threshold check
      const feats = customLayersDataRef.current?.movements?.features;
      console.log(`   Features available: ${feats ? feats.length : 'null'}`);
      if (feats) {
        updateNodeMarkers(feats);
      } else {
        console.warn('   ⚠️ No features available in customLayersDataRef');
      }
    };
    map.on('zoomend', handleZoomForTurnBoxes);

    // Wait for style to be fully loaded before setting mapLoaded
    const handleStyleLoad = () => {
      map.once('idle', () => {
        setMapLoaded(true);
      });
    };

    // Check if style is already loaded or wait for it
    if (map.isStyleLoaded()) {
      handleStyleLoad();
    } else {
      map.once('style.load', handleStyleLoad);
    }

    return () => {
      map.off('zoomend', handleZoomForTurnBoxes);
      clearNodeMarkers();
      map.remove();
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    
    const map = mapRef.current;
    
    // Wait for style to be fully loaded
    if (!map.isStyleLoaded()) {
      const waitForStyle = () => {
        if (map.isStyleLoaded()) {
          loadData();
        } else {
          setTimeout(waitForStyle, 100);
        }
      };
      waitForStyle();
      return;
    }
    
    setSelectedMovements([]);
    setSelectedTimeInt('all');
    
    const loadData = async () => {
      try {
        // Safely remove existing layers and sources
        const layersToRemove = ['movement-labels', 'movement-arrowheads', 'movement-lines', 'links-line'];
        layersToRemove.forEach(layerId => {
          if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
          }
        });
        
        const sourcesToRemove = ['movements', 'links'];
        sourcesToRemove.forEach(sourceId => {
          if (map.getSource(sourceId)) {
            map.removeSource(sourceId);
          }
        });

        const resLinks = await fetch(`${BASE_URL}data/Links_Opt3.geojson`);
        if (!resLinks.ok) throw new Error('Links_Opt3.geojson not found');

        const linksData = await resLinks.json();
        setLinksGeoJSON(linksData);

        map.addSource('links', { type: 'geojson', data: linksData });
        map.addLayer({
          id: 'links-line',
          type: 'line',
          source: 'links',
          paint: {
            'line-color': 'rgba(128, 128, 128, 0.75)',
            'line-width': 2,
          },
        });

        const fileName = timePeriod === 'AM' ? `${BASE_URL}data/Node_AM.txt` : `${BASE_URL}data/Node_PM.txt`;
        const resMov = await fetch(fileName);
        if (!resMov.ok) throw new Error(`${fileName} not found`);
        const text = await resMov.text();
        const allRows = text.split('\n');
        
        const rows = allRows.slice(1).filter(row => row.trim() && !row.includes('TIMEINT'));

        console.log(`📄 Total rows in ${fileName}:`, rows.length);

        const movementFeatures = [];
        const uniqueTimeIntervals = new Set();

        rows.forEach((row, index) => {
          if (!row.trim()) return;
          const cols = row.split('\t');
          
          if (cols[1] && cols[1].trim() === 'TIMEINT') return;
          
          if (cols.length < 7) return;

          const timeInt = cols[1].trim();
          const fromLink = cols[3].trim();
          const toLink = cols[4].trim();
          const vehs = parseFloat(cols[5]) || 0;
          
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
          // Use the LAST coordinate as the end of the from link (where traffic arrives at the intersection)
          const fromEnd = fromCoords[fromCoords.length - 1];
          
          // Debug: log first few to verify
          if (movementFeatures.length < 5) {
            console.log(`   🔍 fromLink ${fromLink}: fromEnd = [${fromEnd[0].toFixed(6)}, ${fromEnd[1].toFixed(6)}] (last coord of ${fromCoords.length} coords)`);
          }
          
          const toCoords = toFeature.geometry.coordinates;
          const toStart = toCoords[0];

          // Node location for per-intersection aggregation/labels.
          // In most cases, fromEnd and toStart are extremely close; midpoint is more stable.
          const nodeCoord = [
            (fromEnd[0] + toStart[0]) / 2,
            (fromEnd[1] + toStart[1]) / 2,
          ];

          const fromDir = fromCoords.length >= 2 ? {
            x: fromCoords[fromCoords.length - 1][0] - fromCoords[fromCoords.length - 2][0],
            y: fromCoords[fromCoords.length - 1][1] - fromCoords[fromCoords.length - 2][1]
          } : null;

          const toDir = toCoords.length >= 2 ? {
            x: toCoords[1][0] - toCoords[0][0],
            y: toCoords[1][1] - toCoords[0][1]
          } : null;

          let turnType = 'through';
          // Always calculate fromAngle if fromDir exists (needed for box rotation)
          let fromAngle = fromDir ? Math.atan2(fromDir.y, fromDir.x) : null;
          
          if (fromDir && toDir) {
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

          // Standardise turn geometry (shape/size) by:
          // - trimming both approaches to a fixed length (meters)
          // - using a fixed curvature offset (meters) per turn type
          const TURN_APPROACH_LENGTH_M = 28; // how far to pull back from the node on each link
          const TURN_CURVE_OFFSET_M = {
            through: 0,
            left: 14,
            right: 14,
            uturn: 26,
          };

          const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

          // Convert a lon/lat delta (degrees) to meters at given latitude.
          const degDeltaToMeters = (dxDeg, dyDeg, latDeg) => {
            const latRad = (latDeg * Math.PI) / 180;
            const metersPerDegLat = 111_320;
            const metersPerDegLon = 111_320 * Math.cos(latRad);
            return {
              x: dxDeg * metersPerDegLon,
              y: dyDeg * metersPerDegLat,
            };
          };

          // Convert a meters delta to lon/lat delta (degrees) at given latitude.
          const metersToDegDelta = (dxM, dyM, latDeg) => {
            const latRad = (latDeg * Math.PI) / 180;
            const metersPerDegLat = 111_320;
            const metersPerDegLon = 111_320 * Math.cos(latRad);
            return {
              x: metersPerDegLon === 0 ? 0 : dxM / metersPerDegLon,
              y: dyM / metersPerDegLat,
            };
          };

          const normalizeMetersVec = (xM, yM) => {
            const len = Math.sqrt(xM * xM + yM * yM);
            if (!len) return { x: 0, y: 0, len: 0 };
            return { x: xM / len, y: yM / len, len };
          };

          // Move a point along a direction vector (given in degrees delta) by N meters.
          const movePointByMetersAlongDir = (point, dirDeg, meters) => {
            const lat = point[1];
            const dirM = degDeltaToMeters(dirDeg.x, dirDeg.y, lat);
            const unit = normalizeMetersVec(dirM.x, dirM.y);
            if (!unit.len) return point;
            const stepM = { x: unit.x * meters, y: unit.y * meters };
            const stepDeg = metersToDegDelta(stepM.x, stepM.y, lat);
            return [point[0] + stepDeg.x, point[1] + stepDeg.y];
          };

          const createCurvedLine = (rawStart, rawEnd, segments = 24) => {
            // Trim ends to a fixed approach length so the visible "turn" segment is consistent.
            let start = rawStart;
            let end = rawEnd;

            if (fromDir) {
              // Move backwards along fromDir (towards upstream) by TURN_APPROACH_LENGTH_M
              start = movePointByMetersAlongDir(rawStart, { x: -fromDir.x, y: -fromDir.y }, TURN_APPROACH_LENGTH_M);
            }
            if (toDir) {
              // Move forwards along toDir (towards downstream) by TURN_APPROACH_LENGTH_M
              end = movePointByMetersAlongDir(rawEnd, { x: toDir.x, y: toDir.y }, TURN_APPROACH_LENGTH_M);
            }

            const coords = [];
            const dx = end[0] - start[0];
            const dy = end[1] - start[1];
            const midLat = (start[1] + end[1]) / 2;
            const chordM = degDeltaToMeters(dx, dy, midLat);
            const chordLenM = Math.sqrt(chordM.x * chordM.x + chordM.y * chordM.y);
            
            if (turnType === 'through') {
              for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                coords.push([
                  start[0] + t * dx,
                  start[1] + t * dy
                ]);
              }
            } else {
              // Compute curvature based on the "main" turn direction (incoming + outgoing link vectors),
              // not the chord between endpoints (which can look wrong for skewed intersections).
              const node = [
                (rawStart[0] + rawEnd[0]) / 2,
                (rawStart[1] + rawEnd[1]) / 2,
              ];
              const nodeLat = node[1];

              // Incoming direction *away from the node* and outgoing direction *away from the node*.
              const inDeg = fromDir ? { x: -fromDir.x, y: -fromDir.y } : null;
              const outDeg = toDir ? { x: toDir.x, y: toDir.y } : null;

              const inM = inDeg ? degDeltaToMeters(inDeg.x, inDeg.y, nodeLat) : { x: 0, y: 0 };
              const outM = outDeg ? degDeltaToMeters(outDeg.x, outDeg.y, nodeLat) : { x: 0, y: 0 };

              const inU = normalizeMetersVec(inM.x, inM.y);
              const outU = normalizeMetersVec(outM.x, outM.y);

              // Cross product sign picks left/right consistently in map coordinates (x=east, y=north).
              const cross = (inU.x * outU.y) - (inU.y * outU.x);
              const turnSideSign =
                cross !== 0 ? Math.sign(cross) : (turnType === 'right' ? -1 : 1);

              // Bisector points roughly through the curve apex.
              const bis = normalizeMetersVec(inU.x + outU.x, inU.y + outU.y);

              // Fixed curvature offset in meters, clamped for very short chords.
              let offsetM = TURN_CURVE_OFFSET_M[turnType] ?? 14;
              offsetM = clamp(offsetM, 0, Math.max(10, chordLenM * 0.75));

              // Push control point forward from the node (along bisector), plus lateral offset.
              const CONTROL_FORWARD_M = clamp(TURN_APPROACH_LENGTH_M * 0.75, 12, 24);

              // Lateral direction: perpendicular to incoming direction (fallback to chord if needed).
              const baseU = inU.len ? inU : (normalizeMetersVec(chordM.x, chordM.y));
              const lateralU = { x: -baseU.y, y: baseU.x };

              const controlM = {
                x: (bis.len ? bis.x : 0) * CONTROL_FORWARD_M + lateralU.x * offsetM * turnSideSign,
                y: (bis.len ? bis.y : 0) * CONTROL_FORWARD_M + lateralU.y * offsetM * turnSideSign,
              };
              const controlDeg = metersToDegDelta(controlM.x, controlM.y, nodeLat);

              const controlX = node[0] + controlDeg.x;
              const controlY = node[1] + controlDeg.y;
              
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
              TURNTYPE: turnType,
              NODE: nodeCoord,
              FROM_LINK: fromLink,
              TO_LINK: toLink, // Store to link to distinguish multiple movements
              FROM_LINK_POS: fromEnd, // Position for the turn box (at end of from link)
              FROM_ANGLE: fromAngle, // Angle in radians for rotating the box
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
                TURNTYPE: feature.properties.TURNTYPE,
                NODE: feature.properties.NODE,
                FROM_LINK: feature.properties.FROM_LINK,
                TO_LINK: feature.properties.TO_LINK,
                FROM_LINK_POS: feature.properties.FROM_LINK_POS,
                FROM_ANGLE: feature.properties.FROM_ANGLE,
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
          
          if (isNaN(startSec) || isNaN(endSec)) {
            console.warn('Invalid time interval:', interval);
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

        // Add movement lines layer (colored turn lines)
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
          layout: {
            visibility: showColoredTurns ? 'visible' : 'none'
          }
        });

        // Commented out arrow loading
        // const loadArrowImages = async () => {
        //   const arrowTypes = ['left', 'through', 'right', 'uturn'];
        //   
        //   for (const type of arrowTypes) {
        //     try {
        //       if (map.hasImage(`arrow-${type}`)) continue;
        //       
        //       const response = await fetch(`${BASE_URL}arrows/_arrow-${type}.svg`);
        //       if (!response.ok) {
        //         console.warn(`Could not load arrow-${type}.svg, using fallback`);
        //         continue;
        //       }
        //       const svgText = await response.text();
        //       
        //       const img = new Image(32, 32);
        //       await new Promise((resolve, reject) => {
        //         img.onload = () => {
        //           map.addImage(`arrow-${type}`, img);
        //           resolve();
        //         };
        //         img.onerror = () => {
        //           console.error(`Failed to load arrow-${type}`);
        //           reject();
        //         };
        //         img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
        //       });
        //     } catch (error) {
        //       console.error(`Error loading arrow-${type}:`, error);
        //     }
        //   }
        // };

        // await loadArrowImages();
        
        // Commented out movement-arrowheads layer
        // map.addLayer({
        //   id: 'movement-arrowheads',
        //   type: 'symbol',
        //   source: 'movements',
        //   layout: {
        //     'symbol-placement': 'line-center',
        //     'icon-image': [
        //       'match',
        //       ['get', 'TURNTYPE'],
        //       'left', 'arrow-left',
        //       'right', 'arrow-right',
        //       'uturn', 'arrow-uturn',
        //       'arrow-through'
        //     ],
        //     'icon-size': [
        //       'interpolate',
        //       ['linear'],
        //       ['get', 'VEHS'],
        //       0, 0.7,
        //       500, 0.9,
        //       1000, 1.1,
        //       2000, 1.3
        //     ],
        //     'icon-allow-overlap': true,
        //     'icon-rotation-alignment': 'map',
        //     'icon-pitch-alignment': 'viewport',
        //   },
        // });
        
        // Add movement labels layer
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
            visibility: showColoredTurns ? 'visible' : 'none'
          },
          paint: {
            'text-color': 'rgba(255, 255, 255, 1)',
            'text-halo-color': 'rgba(0, 0, 0, 0.8)',
            'text-halo-width': 2,
          },
        });
        
        console.log('✅ Movement labels added');

        // Render per-node turn boxes for the initial view ("all").
        console.log(`\n📦 INITIAL LOAD: Calling updateNodeMarkers with ${initialFilteredMovements.features.length} features`);
        updateNodeMarkers(initialFilteredMovements.features);
        
        setTimeout(() => {
          if (map.getLayer('movement-labels')) {
            map.off('click', 'movement-labels');
            map.off('mouseenter', 'movement-labels');
            map.off('mouseleave', 'movement-labels');
            
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
        
      } catch (err) {
        console.error('Error loading data:', err);
      }
    };
    
    loadData();
  }, [timePeriod, mapLoaded, showColoredTurns]);

  // Toggle colored turn lines + movement labels on/off
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const visibility = showColoredTurns ? 'visible' : 'none';

    if (map.getLayer('movement-lines')) {
      map.setLayoutProperty('movement-lines', 'visibility', visibility);
    }
    if (map.getLayer('movement-labels')) {
      map.setLayoutProperty('movement-labels', 'visibility', visibility);
    }
  }, [showColoredTurns, mapLoaded]);

  useEffect(() => {
    if (!mapRef.current || !allMovements || !mapLoaded) return;

    const map = mapRef.current;
    
    // Ensure style is loaded before accessing source
    if (!map.isStyleLoaded()) {
      return;
    }
    
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

    // Update per-node turn boxes whenever filtering changes.
    console.log(`\n⏰ TIME FILTER CHANGE: Calling updateNodeMarkers with ${filteredMovements.features.length} features`);
    updateNodeMarkers(filteredMovements.features);
    
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
  }, [selectedTimeInt, allMovements, mapLoaded]);

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
            Display Options
          </h3>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            fontSize: '14px'
          }}>
            <input
              type="checkbox"
              checked={showColoredTurns}
              onChange={(e) => setShowColoredTurns(e.target.checked)}
              style={{
                width: '18px',
                height: '18px',
                cursor: 'pointer'
              }}
            />
            <span>Show Colored Turns & Labels</span>
          </label>
        </div>
        
        {/* Turn Types legend hidden */}
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
        {onLogout && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
            paddingBottom: '10px',
            borderBottom: '1px solid #e0e0e0'
          }}>
            <span style={{ fontSize: '12px', color: '#666' }}>{userEmail}</span>
            <button
              onClick={onLogout}
              style={{
                padding: '6px 12px',
                background: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '500'
              }}
            >
              Logout
            </button>
          </div>
        )}
        <div style={{
          fontSize: '16px',
          marginBottom: '15px',
          paddingBottom: '15px',
          borderBottom: '2px solid #000',
          letterSpacing: '2px'
        }}>
 Western Freeway Bussiness Case
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