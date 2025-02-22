import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import { FaSearch, FaPen, FaTrash, FaRuler, FaUndo, FaRedo, FaSave, FaLayerGroup, FaLocationArrow } from 'react-icons/fa';
import { MdGpsFixed, MdGpsNotFixed } from 'react-icons/md';

// Import leaflet-draw properly
if (typeof window !== 'undefined') {
  require('leaflet-draw');
}

// Extend the L namespace without redefining existing types
declare module 'leaflet' {
  namespace GeometryUtil {
    function geodesicArea(latLngs: L.LatLng[]): number;
  }

  interface DrawOptions {
    showArea?: boolean;
    shapeOptions?: {
      color?: string;
      fillColor?: string;
      fillOpacity?: number;
      weight?: number;
      opacity?: number;
    };
    touchIcon?: L.DivIcon;
    allowIntersection?: boolean;
  }

  interface Draw {
    Polygon: new (map: L.Map, options?: DrawOptions) => any;
  }

  interface DrawConstructor {
    Polygon: new (map: L.Map, options?: DrawOptions) => any;
  }

  interface Map {
    draw?: DrawConstructor;
  }
}

interface MapProps {
  onAreaUpdate?: (newArea: number) => void;
}

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

type MeasurementUnit = 'ha' | 'sqm' | 'acre' | 'sqft';

const UNIT_CONVERSIONS = {
  ha: {
    toSqMeters: 10000,
    fromSqMeters: 1/10000,
    decimals: 2
  },
  sqm: {
    toSqMeters: 1,
    fromSqMeters: 1,
    decimals: 0
  },
  acre: {
    toSqMeters: 4046.86,
    fromSqMeters: 1/4046.86,
    decimals: 2
  },
  sqft: {
    toSqMeters: 0.092903,
    fromSqMeters: 1/0.092903,
    decimals: 0
  }
};

// Update the TILE_LAYERS constant with appropriate zoom levels
const TILE_LAYERS = {
  satellite: {
    url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',  // Updated to Google Satellite
    attribution: '&copy; Google Maps',
    maxNativeZoom: 21,  // Maximum zoom level where tiles are available
    maxZoom: 21        // Maximum zoom level for the map
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap contributors',
    maxNativeZoom: 17,
    maxZoom: 17
  },
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxNativeZoom: 19,
    maxZoom: 19
  }
};

// Update the India center coordinates with proper typing
const INDIA_CENTER: L.LatLngTuple = [20.5937, 78.9629];  // Center of India
const INDIA_DEFAULT_ZOOM = 5;  // Shows most of India

// Add these type definitions at the top of your file
type UndoAction = {
  type: 'add' | 'delete';
  layer: L.Layer;
};

const Map: React.FC<MapProps> = ({ onAreaUpdate }) => {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [areaSize, setAreaSize] = useState<string>('0');
  const [selectedUnit, setSelectedUnit] = useState<MeasurementUnit>('ha');
  const [mapLayer, setMapLayer] = useState<'satellite' | 'terrain' | 'street'>('satellite');
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'searching' | 'found' | 'error'>('idle');
  const [locationError, setLocationError] = useState<string>('');
  const [drawHandler, setDrawHandler] = useState<any>(null);

  // Update your useEffect for map initialization
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      minZoom: 4,
      maxZoom: TILE_LAYERS[mapLayer].maxZoom,
      zoomControl: false,  // Disable default zoom control
    }).setView(INDIA_CENTER, INDIA_DEFAULT_ZOOM);
    
    // Add custom zoom control to bottom right
    L.control.zoom({
      position: 'bottomright'
    }).addTo(map);

    // Add India boundary restrictions with proper typing
    const southWest: L.LatLngTuple = [6.7548, 68.1862];    // India's SW corner
    const northEast: L.LatLngTuple = [35.6745, 97.3959];   // India's NE corner
    const bounds = L.latLngBounds(southWest, northEast);
    
    map.setMaxBounds(bounds);
    map.on('drag', () => {
      map.panInsideBounds(bounds, { animate: false });
    });
    
    mapRef.current = map;

    // Initialize the base tile layer with proper zoom settings
    let currentBaseLayer = L.tileLayer(TILE_LAYERS[mapLayer].url, {
      attribution: TILE_LAYERS[mapLayer].attribution,
      maxNativeZoom: TILE_LAYERS[mapLayer].maxNativeZoom,
      maxZoom: TILE_LAYERS[mapLayer].maxZoom
    }).addTo(map);

    // Add labels layer for satellite view with proper zoom settings
    let labelsLayer: L.TileLayer | null = null;
    if (mapLayer === 'satellite') {
      labelsLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}', {
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        pane: 'overlayPane',
        opacity: 0.9,
        maxNativeZoom: 19,
        maxZoom: 19
      }).addTo(map);
    }

    // Create the FeatureGroup for drawn items
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    drawnItemsRef.current = drawnItems;

    // Add draw created event listener
    map.on((L as any).Draw.Event.CREATED, handleDrawCreated);

    // Add draw events for editing if needed
    map.on((L as any).Draw.Event.EDITED, (e: any) => {
      updateAreaSize();
    });

    map.on((L as any).Draw.Event.DELETED, (e: any) => {
      updateAreaSize();
    });

    // Cleanup function
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    
    // Update map max zoom based on selected layer
    map.setMaxZoom(TILE_LAYERS[mapLayer].maxZoom);
    
    // Remove existing layers
    map.eachLayer((layer: any) => {
      if (layer instanceof L.TileLayer) {
        map.removeLayer(layer);
      }
    });
    
    // Add new base layer with proper zoom settings
    L.tileLayer(TILE_LAYERS[mapLayer].url, {
      attribution: TILE_LAYERS[mapLayer].attribution,
      maxNativeZoom: TILE_LAYERS[mapLayer].maxNativeZoom,
      maxZoom: TILE_LAYERS[mapLayer].maxZoom
    }).addTo(map);

    // Add labels layer for satellite view with proper zoom settings
    if (mapLayer === 'satellite') {
      L.tileLayer('https://{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}', {
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        pane: 'overlayPane',
        opacity: 0.9,
        maxNativeZoom: 19,
        maxZoom: 19
      }).addTo(map);
    }
  }, [mapLayer]);

  const updateAreaSize = () => {
    if (!drawnItemsRef.current) return;
    
    let totalAreaInSqMeters = 0;
    drawnItemsRef.current.eachLayer((layer: any) => {
      if (layer instanceof L.Polygon) {
        const latLngs = layer.getLatLngs()[0] as L.LatLng[];
        totalAreaInSqMeters = L.GeometryUtil.geodesicArea(latLngs);
      }
    });

    // Convert from square meters to selected unit
    const conversion = UNIT_CONVERSIONS[selectedUnit];
    const convertedArea = totalAreaInSqMeters * conversion.fromSqMeters;
    
    // Format with appropriate decimal places
    setAreaSize(convertedArea.toFixed(conversion.decimals));
    
    // Call the onAreaUpdate prop if it exists
    if (onAreaUpdate) {
      onAreaSize(convertedArea);
    }
  };

  const startDrawing = () => {
    if (!mapRef.current) return;
    
    // If already drawing, disable it
    if (isDrawing && drawHandler) {
      drawHandler.disable();
      setDrawHandler(null);
      setIsDrawing(false);
      return;
    }

    // Start new drawing
    const polygonDrawHandler = new (L as any).Draw.Polygon(mapRef.current, {
      showArea: true,
      shapeOptions: {
        color: '#3388ff',
        fillColor: '#3388ff',
        fillOpacity: 0.2,
        weight: 3,
        opacity: 0.8
      },
      touchIcon: new L.DivIcon({
        className: 'leaflet-div-icon',
        iconSize: new L.Point(20, 20),
        iconAnchor: new L.Point(10, 10)
      }),
      allowIntersection: false
    });
    
    polygonDrawHandler.enable();
    setDrawHandler(polygonDrawHandler);
    setIsDrawing(true);
  };

  useEffect(() => {
    const searchTimeout = setTimeout(async () => {
      if (searchQuery.trim().length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?` +
          `format=json&` +
          `q=${encodeURIComponent(searchQuery)}+Rajasthan+India&` +
          `limit=5&` +
          `dedupe=1`
        );
        
        const data = await response.json();
        
        const processedResults = data.map((item: any) => ({
          display_name: item.display_name,
          lat: item.lat,
          lon: item.lon
        }));

        setSearchResults(processedResults);
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setIsSearching(false);
      }
    }, 30);

    return () => clearTimeout(searchTimeout);
  }, [searchQuery]);

  const handleResultClick = (result: SearchResult) => {
    if (!mapRef.current) return;

    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);

    mapRef.current.setView([lat, lon], 14, {
      animate: true,
      duration: 1.5
    });

    setSearchResults([]);
    setSearchQuery('');
  };

  // Enhanced GPS Location function
  const getCurrentLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocationError("GPS not supported in your browser");
      setGpsStatus('error');
      return;
    }

    setGpsStatus('searching');
    setLocationError('');

    const options = {
      enableHighAccuracy: true, // Request high accuracy
      timeout: 10000,          // Time to wait for response (10 seconds)
      maximumAge: 0            // Don't use cached position
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        
        if (accuracy > 100) { // If accuracy is worse than 100 meters
          setLocationError(`Warning: GPS accuracy is ${Math.round(accuracy)}m`);
        }

        if (mapRef.current) {
          // Smoothly animate to the location
          mapRef.current.flyTo([latitude, longitude], 18, {
            duration: 2
          });

          // Add a marker with accuracy circle
          if (drawnItemsRef.current) {
            drawnItemsRef.current.clearLayers();
            
            // Add marker at current position
            const marker = L.marker([latitude, longitude], {
              title: 'Your Location',
              icon: L.divIcon({
                className: 'gps-marker',
                html: `<div class="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg"></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
              })
            });

            // Add accuracy circle
            const accuracyCircle = L.circle([latitude, longitude], {
              radius: accuracy,
              color: '#3388ff',
              fillColor: '#3388ff',
              fillOpacity: 0.1,
              weight: 1
            });

            drawnItemsRef.current.addLayer(marker);
            drawnItemsRef.current.addLayer(accuracyCircle);
          }
        }

        setGpsStatus('found');
      },
      (error) => {
        let errorMessage = "Failed to get location";
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = "Please allow GPS access to use this feature";
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = "Location information unavailable";
            break;
          case error.TIMEOUT:
            errorMessage = "Location request timed out";
            break;
        }
        setLocationError(errorMessage);
        setGpsStatus('error');
      },
      options
    );

    // Watch for continuous updates
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        
        if (mapRef.current && drawnItemsRef.current) {
          drawnItemsRef.current.eachLayer((layer: any) => {
            if (layer instanceof L.Marker) {
              layer.setLatLng([latitude, longitude]);
            }
            if (layer instanceof L.Circle) {
              layer.setLatLng([latitude, longitude]);
              layer.setRadius(accuracy);
            }
          });
        }
      },
      null,
      options
    );

    // Cleanup watch on component unmount
    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  };

  // Add this CSS to your styles
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .gps-marker {
        animation: pulse 2s infinite;
      }
      @keyframes pulse {
        0% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.2); opacity: 0.8; }
        100% { transform: scale(1); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Update the handleDrawCreated function
  const handleDrawCreated = (e: any) => {
    const layer = e.layer;
    if (drawnItemsRef.current) {
      drawnItemsRef.current.addLayer(layer);
      
      // Save to undo stack with correct typing
      setUndoStack(prev => [...prev, {
        type: 'add',
        layer: layer
      }]);
      setRedoStack([]);

      // Update area calculation
      updateAreaSize();
    }
  };

  // Update the handleUndo function
  const handleUndo = () => {
    if (undoStack.length === 0 || !drawnItemsRef.current) return;

    const lastAction = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));

    if (lastAction.type === 'add') {
      drawnItemsRef.current.removeLayer(lastAction.layer);
      setRedoStack(prev => [...prev, lastAction]);
    } else if (lastAction.type === 'delete') {
      drawnItemsRef.current.addLayer(lastAction.layer);
      setRedoStack(prev => [...prev, {
        type: 'add',
        layer: lastAction.layer
      }]);
    }

    updateAreaSize();
  };

  // Update the handleRedo function if you have one
  const handleRedo = () => {
    if (redoStack.length === 0 || !drawnItemsRef.current) return;

    const lastAction = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));

    if (lastAction.type === 'add') {
      drawnItemsRef.current.addLayer(lastAction.layer);
      setUndoStack(prev => [...prev, lastAction]);
    } else if (lastAction.type === 'delete') {
      drawnItemsRef.current.removeLayer(lastAction.layer);
      setUndoStack(prev => [...prev, {
        type: 'delete',
        layer: lastAction.layer
      }]);
    }

    updateAreaSize();
  };

  // Add some CSS to style the zoom controls
  useEffect(() => {
    // Add custom CSS for zoom controls
    const style = document.createElement('style');
    style.textContent = `
      .leaflet-control-zoom {
        margin-bottom: 80px !important;  /* Add space above bottom tools */
        margin-right: 20px !important;   /* Add space from right edge */
        border: none !important;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3) !important;
      }
      .leaflet-control-zoom a {
        width: 36px !important;
        height: 36px !important;
        line-height: 36px !important;
        border-radius: 8px !important;
        background-color: white !important;
        color: #666 !important;
        border: 1px solid #ddd !important;
      }
      .leaflet-control-zoom a:first-child {
        margin-bottom: 4px !important;
      }
      .leaflet-control-zoom a:hover {
        background-color: #f4f4f4 !important;
        color: #333 !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  return (
    <div className="absolute inset-0">
      {/* Search Bar */}
      <div className="absolute top-4 right-4 z-[1000] w-[calc(100%-32px)] sm:w-[300px] px-4 sm:px-0">
        <div className="bg-white shadow-lg rounded-lg">
          <div className="p-2">
            <div className="relative flex items-center">
              <FaSearch className="absolute left-3 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search location..."
                className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {isSearching && (
                <div className="absolute right-3">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-blue-600" />
                </div>
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="mt-2 max-h-60 overflow-y-auto">
                {searchResults.map((result, index) => (
                  <div
                    key={index}
                    onClick={() => handleResultClick(result)}
                    className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm border-b last:border-b-0"
                  >
                    {result.display_name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Area Display - Further reduced width */}
      <div className="absolute top-24 sm:top-4 left-1/2 -translate-x-1/2 z-[1000] bg-white shadow-lg rounded-lg px-2 py-1 sm:px-4 sm:py-2 w-[200px] sm:w-auto">
        <div className="flex items-center justify-between sm:justify-start gap-1 sm:gap-2">
          <span className="text-gray-500 text-xs sm:text-base whitespace-nowrap">Area:</span>
          <span className="font-semibold text-blue-600 text-xs sm:text-base">{areaSize}</span>
          <select
            className="ml-1 text-xs sm:text-base bg-gray-50 border border-gray-200 rounded px-1 py-0.5 sm:px-2 sm:py-1 outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedUnit}
            onChange={(e) => {
              setSelectedUnit(e.target.value as MeasurementUnit);
              updateAreaSize();
            }}
          >
            <option value="ha">ha</option>
            <option value="sqm">m²</option>
            <option value="acre">ac</option>
            <option value="sqft">ft²</option>
          </select>
        </div>
      </div>

      {/* Left Sidebar Tools Panel */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 sm:left-4 sm:top-1/2 sm:-translate-y-1/2 sm:translate-x-0 z-[1000]">
        <div className="bg-white shadow-lg rounded-lg p-2 sm:p-3">
          <div className="flex sm:flex-col gap-2 sm:gap-3">
            {/* GPS Button */}
            <button
              className={`flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg transition-all duration-200 relative group ${
                gpsStatus === 'searching' 
                  ? 'bg-yellow-50 text-yellow-700'
                  : gpsStatus === 'found'
                  ? 'bg-green-50 text-green-700'
                  : gpsStatus === 'error'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-gray-50 hover:bg-gray-100'
              }`}
              onClick={getCurrentLocation}
              disabled={gpsStatus === 'searching'}
              title="My Location"
            >
              {gpsStatus === 'searching' ? (
                <MdGpsNotFixed className="animate-spin" size={20} />
              ) : (
                <MdGpsFixed size={20} />
              )}
              <span className="hidden sm:block absolute left-full ml-2 bg-black text-white text-sm px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap">
                My Location
              </span>
            </button>

            {/* Updated Draw Button */}
            <button
              className={`flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg transition-all duration-200 relative group ${
                isDrawing 
                  ? 'bg-blue-500 text-white shadow-inner' 
                  : 'bg-gray-50 hover:bg-gray-100'
              }`}
              onClick={startDrawing}
              title={isDrawing ? "Stop Drawing" : "Draw Field"}
            >
              <FaPen size={18} />
              <span className="hidden sm:block absolute left-full ml-2 bg-black text-white text-sm px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap">
                {isDrawing ? "Stop Drawing" : "Draw Field"}
              </span>
            </button>

            {/* Undo Button */}
            <button
              className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-gray-50 hover:bg-gray-100 transition-all duration-200 disabled:opacity-50 relative group"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              title="Undo"
            >
              <FaUndo size={18} />
              <span className="hidden sm:block absolute left-full ml-2 bg-black text-white text-sm px-2 py-1 rounded opacity-0 group-hover:opacity-100">
                Undo
              </span>
            </button>

            {/* Redo Button */}
            <button
              className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-gray-50 hover:bg-gray-100 transition-all duration-200 disabled:opacity-50 relative group"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              title="Redo"
            >
              <FaRedo size={18} />
              <span className="hidden sm:block absolute left-full ml-2 bg-black text-white text-sm px-2 py-1 rounded opacity-0 group-hover:opacity-100">
                Redo
              </span>
            </button>

            {/* Layer Selector */}
            <button
              className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-gray-50 hover:bg-gray-100 transition-all duration-200 relative group"
              onClick={() => {
                const layers = ['satellite', 'terrain', 'street'];
                const currentIndex = layers.indexOf(mapLayer);
                const nextIndex = (currentIndex + 1) % layers.length;
                setMapLayer(layers[nextIndex] as 'satellite' | 'terrain' | 'street');
              }}
              title="Change Map Layer"
            >
              <FaLayerGroup size={18} />
              <span className="hidden sm:block absolute left-full ml-2 bg-black text-white text-sm px-2 py-1 rounded opacity-0 group-hover:opacity-100">
                {mapLayer.charAt(0).toUpperCase() + mapLayer.slice(1)} View
              </span>
            </button>

            {/* Clear Button */}
            <button
              className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-gray-50 hover:bg-gray-100 transition-all duration-200 relative group"
              onClick={() => {
                if (drawnItemsRef.current) {
                  drawnItemsRef.current.clearLayers();
                  setAreaSize('0');
                  setUndoStack([]);
                  setRedoStack([]);
                }
              }}
              title="Clear All"
            >
              <FaTrash size={18} />
              <span className="hidden sm:block absolute left-full ml-2 bg-black text-white text-sm px-2 py-1 rounded opacity-0 group-hover:opacity-100">
                Clear All
              </span>
            </button>
          </div>

          {locationError && (
            <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded-lg">
              {locationError}
            </div>
          )}
        </div>
      </div>

      {/* Map Container */}
      <div 
        ref={mapContainerRef} 
        className="w-full h-full"
      />
    </div>
  );
};

export default Map;