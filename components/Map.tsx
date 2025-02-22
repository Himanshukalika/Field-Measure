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

// Add this type declaration at the top of the file
declare module 'leaflet' {
  namespace GeometryUtil {
    function geodesicArea(latLngs: L.LatLng[]): number;
  }
}

interface MapProps {}

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

type MeasurementUnit = 'ha' | 'sqm' | 'acre' | 'sqft';

const UNIT_CONVERSIONS = {
  ha: 1,
  sqm: 10000,
  acre: 2.47105,
  sqft: 107639
};

const Map: React.FC<MapProps> = () => {
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
  const [undoStack, setUndoStack] = useState<L.LatLng[][]>([]);
  const [redoStack, setRedoStack] = useState<L.LatLng[][]>([]);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'searching' | 'found' | 'error'>('idle');
  const [locationError, setLocationError] = useState<string>('');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!mapRef.current && mapContainerRef.current) {
      mapRef.current = L.map(mapContainerRef.current, {
        // Disable default zoom control
        zoomControl: false
      }).setView([23.5937, 78.9629], 5);
      
      // Add custom positioned zoom control to bottom right
      L.control.zoom({
        position: 'bottomright'
      }).addTo(mapRef.current);
      
      L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
        maxZoom: 21,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '© Google Maps'
      }).addTo(mapRef.current);

      // Initialize drawing feature group
      drawnItemsRef.current = new L.FeatureGroup();
      mapRef.current.addLayer(drawnItemsRef.current);

      // Drawing events
      mapRef.current.on(L.Draw.Event.DRAWSTART, () => {
        setIsDrawing(true);
        if (drawnItemsRef.current) {
          drawnItemsRef.current.clearLayers();
        }
      });

      mapRef.current.on(L.Draw.Event.DRAWSTOP, () => {
        setIsDrawing(false);
      });

      mapRef.current.on(L.Draw.Event.CREATED, (e: any) => {
        const layer = e.layer;
        drawnItemsRef.current?.addLayer(layer);
        updateAreaSize();
        
        // Save for undo
        const coordinates = layer.getLatLngs()[0];
        setUndoStack(prev => [...prev, coordinates]);
        setRedoStack([]);

        // Make the polygon editable
        layer.editing.enable();
      });

      // Update area when polygon is edited
      mapRef.current.on('editable:editing', updateAreaSize);
    }

    // Handle window resize
    const handleResize = () => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const updateAreaSize = () => {
    if (!drawnItemsRef.current) return;
    
    let totalArea = 0;
    drawnItemsRef.current.eachLayer((layer: any) => {
      if (layer instanceof L.Polygon) {
        const latLngs = layer.getLatLngs()[0] as L.LatLng[];
        totalArea = L.GeometryUtil.geodesicArea(latLngs);
      }
    });

    // Convert to selected unit
    const convertedArea = totalArea / 10000 * UNIT_CONVERSIONS[selectedUnit];
    setAreaSize(convertedArea.toFixed(2));
  };

  const startDrawing = () => {
    if (!mapRef.current) return;
    
    const polygonDrawHandler = new L.Draw.Polygon(mapRef.current, {
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

  // Undo/Redo functions
  const handleUndo = () => {
    if (undoStack.length > 0) {
      const lastPolygon = undoStack[undoStack.length - 1];
      setUndoStack(prev => prev.slice(0, -1));
      setRedoStack(prev => [...prev, lastPolygon]);
      
      if (drawnItemsRef.current) {
        drawnItemsRef.current.clearLayers();
        if (undoStack.length > 1) {
          const polygon = L.polygon(undoStack[undoStack.length - 2]);
          drawnItemsRef.current.addLayer(polygon);
          updateAreaSize();
        }
      }
    }
  };

  const handleRedo = () => {
    if (redoStack.length > 0) {
      const nextPolygon = redoStack[redoStack.length - 1];
      setRedoStack(prev => prev.slice(0, -1));
      setUndoStack(prev => [...prev, nextPolygon]);
      
      if (drawnItemsRef.current) {
        drawnItemsRef.current.clearLayers();
        const polygon = L.polygon(nextPolygon);
        drawnItemsRef.current.addLayer(polygon);
        updateAreaSize();
      }
    }
  };

  // Save measurement data
  const saveMeasurement = async () => {
    if (!drawnItemsRef.current) return;

    const measurementData = {
      area: areaSize,
      unit: selectedUnit,
      coordinates: drawnItemsRef.current.getLayers().map((layer: any) => 
        layer.getLatLngs()[0].map((latlng: L.LatLng) => ({
          lat: latlng.lat,
          lng: latlng.lng
        }))
      ),
      timestamp: new Date().toISOString()
    };

    try {
      // Here you can implement your save logic
      // Example: Save to localStorage
      const savedMeasurements = JSON.parse(localStorage.getItem('measurements') || '[]');
      savedMeasurements.push(measurementData);
      localStorage.setItem('measurements', JSON.stringify(savedMeasurements));
      
      alert('Measurement saved successfully!');
    } catch (error) {
      console.error('Error saving measurement:', error);
      alert('Failed to save measurement');
    }
  };

  return (
    <div className="relative w-full h-screen flex flex-col">
      {/* Search Bar - Responsive positioning */}
      <div className="absolute z-[1000] w-full px-4 sm:px-0 sm:w-72 sm:right-4 top-4">
        <div className="bg-white rounded-lg shadow-lg">
          <div className="p-2">
            <div className="relative flex items-center">
              <FaSearch className="absolute left-3 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search in Rajasthan..."
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm sm:text-base"
              />
              {isSearching && (
                <div className="absolute right-3 text-gray-500">
                  ...
                </div>
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="mt-2 bg-white rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {searchResults.map((result, index) => (
                  <div
                    key={index}
                    onClick={() => handleResultClick(result)}
                    className="p-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0 text-sm sm:text-base"
                  >
                    {result.display_name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Drawing Tools Panel */}
      <div className="absolute z-[1000] left-4 top-4 bg-white rounded-lg shadow-lg p-4">
        <div className="text-center mb-4 font-semibold text-gray-700">
          Field Measurement
        </div>
        <div className="flex flex-col gap-3">
          <button
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              isDrawing ? 'bg-blue-500 text-white' : 'bg-gray-100 hover:bg-gray-200'
            }`}
            onClick={startDrawing}
          >
            <FaPen size={16} />
            <span>Draw Field</span>
          </button>
          
          <div className="flex gap-2">
            <button
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
            >
              <FaUndo size={16} />
            </button>
            <button
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
            >
              <FaRedo size={16} />
            </button>
          </div>

          <button
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              gpsStatus === 'searching' 
                ? 'bg-yellow-100 text-yellow-800' 
                : gpsStatus === 'found'
                ? 'bg-green-100 text-green-800'
                : gpsStatus === 'error'
                ? 'bg-red-100 text-red-800'
                : 'bg-gray-100 hover:bg-gray-200'
            }`}
            onClick={getCurrentLocation}
            disabled={gpsStatus === 'searching'}
          >
            {gpsStatus === 'searching' ? (
              <MdGpsNotFixed className="animate-spin" size={16} />
            ) : (
              <MdGpsFixed size={16} />
            )}
            <span>
              {gpsStatus === 'searching' 
                ? 'Getting Location...' 
                : gpsStatus === 'found'
                ? 'Location Found'
                : 'My Location'}
            </span>
          </button>

          {locationError && (
            <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
              {locationError}
            </div>
          )}

          <select
            className="px-4 py-2 rounded-lg border border-gray-200"
            value={selectedUnit}
            onChange={(e) => {
              setSelectedUnit(e.target.value as MeasurementUnit);
              updateAreaSize();
            }}
          >
            <option value="ha">Hectares</option>
            <option value="sqm">Square Meters</option>
            <option value="acre">Acres</option>
            <option value="sqft">Square Feet</option>
          </select>

          <select
            className="px-4 py-2 rounded-lg border border-gray-200"
            value={mapLayer}
            onChange={(e) => setMapLayer(e.target.value as 'satellite' | 'terrain' | 'street')}
          >
            <option value="satellite">Satellite</option>
            <option value="terrain">Terrain</option>
            <option value="street">Street</option>
          </select>

          <button
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600"
            onClick={saveMeasurement}
          >
            <FaSave size={16} />
            <span>Save</span>
          </button>

          <button
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200"
            onClick={() => {
              if (drawnItemsRef.current) {
                drawnItemsRef.current.clearLayers();
                setAreaSize('0');
                setUndoStack([]);
                setRedoStack([]);
              }
            }}
          >
            <FaTrash size={16} />
            <span>Clear</span>
          </button>

          <div className="mt-2 p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <FaRuler />
              <span>Area Size</span>
            </div>
            <div className="text-lg font-semibold text-blue-600">
              {areaSize} {selectedUnit}
            </div>
          </div>
        </div>
      </div>

      {/* Map Container - Responsive height */}
      <div 
        ref={mapContainerRef} 
        className="flex-1 w-full h-full min-h-[300px] rounded-lg shadow-lg"
      />
    </div>
  );
};

export default Map;