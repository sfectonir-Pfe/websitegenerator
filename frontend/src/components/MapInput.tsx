'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { debounce } from 'lodash';
import DOMPurify from 'dompurify';

interface MapInputProps {
  onSubmit: (mapData: {
    mapDescription: string;
    lat: number;
    lng: number;
    zoom: number;
    markers: Array<{ lat: number; lng: number; title?: string }>;
    width: string;
    height: string;
    mapType: string;
    styles?: string;
    trafficLayer: boolean;
    transitLayer: boolean;
    draggable: boolean;
  }) => void;
  isLoading: boolean;
  initialAddress: string;
}

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const GOOGLE_MAPS_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '';
const MIN_DESCRIPTION_LENGTH = 3;
const MAX_DESCRIPTION_LENGTH = 100;
const MIN_ADDRESS_LENGTH = 5;
const MAX_ADDRESS_LENGTH = 200;

const MapInput: React.FC<MapInputProps> = React.memo(({ onSubmit, isLoading, initialAddress }) => {
  const [mapDescription, setMapDescription] = useState<string>('Generated Map');
  const [lat, setLat] = useState<number>(48.8566);
  const [lng, setLng] = useState<number>(2.3522);
  const [zoom, setZoom] = useState<number>(12);
  const [markers, setMarkers] = useState<Array<{ lat: number; lng: number; title?: string }>>([]);
  const [address, setAddress] = useState<string>(initialAddress);
  const [width, setWidth] = useState<string>('600px');
  const [height, setHeight] = useState<string>('400px');
  const [widthUnit, setWidthUnit] = useState<'px' | '%'>('px');
  const [heightUnit, setHeightUnit] = useState<'px' | '%'>('px');
  const [widthValue, setWidthValue] = useState<number>(600);
  const [heightValue, setHeightValue] = useState<number>(400);
  const [error, setError] = useState<string>('');
  const [isGeocoding, setIsGeocoding] = useState<boolean>(false);
  const [mapType, setMapType] = useState<string>('roadmap');
  const [styles, setStyles] = useState<string>('');
  const [trafficLayer, setTrafficLayer] = useState<boolean>(false);
  const [transitLayer, setTransitLayer] = useState<boolean>(false);
  const [draggable, setDraggable] = useState<boolean>(true);

  const debouncedGeocode = useRef(
    debounce(async (addr: string) => {
      if (addr.length < MIN_ADDRESS_LENGTH || addr.length > MAX_ADDRESS_LENGTH) {
        setError(`Address must be ${MIN_ADDRESS_LENGTH}–${MAX_ADDRESS_LENGTH} characters.`);
        return;
      }
      setIsGeocoding(true);
      setError('');
      try {
        const response = await fetch(`${API_URL}/api/geocode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr }),
        });
        if (!response.ok) throw new Error('Failed to fetch coordinates');
        const data: { coordinates: { lat: number; lng: number } } = await response.json();
        setLat(data.coordinates.lat);
        setLng(data.coordinates.lng);
        setMarkers([{ lat: data.coordinates.lat, lng: data.coordinates.lng, title: addr }]);
      } catch (err) {
        setError('Failed to geocode address');
      } finally {
        setIsGeocoding(false);
      }
    }, 500)
  ).current;

  useEffect(() => {
    if (initialAddress && initialAddress.trim().length >= MIN_ADDRESS_LENGTH) {
      setAddress(DOMPurify.sanitize(initialAddress));
      debouncedGeocode(initialAddress);
    }
    return () => debouncedGeocode.cancel();
  }, [initialAddress]);

  const validateInputs = useCallback((): string | null => {
    if (mapDescription.length < MIN_DESCRIPTION_LENGTH || mapDescription.length > MAX_DESCRIPTION_LENGTH) {
      return `Description must be ${MIN_DESCRIPTION_LENGTH}–${MAX_DESCRIPTION_LENGTH} characters.`;
    }
    if (isNaN(lat) || lat < -90 || lat > 90) return 'Latitude must be between -90 and 90.';
    if (isNaN(lng) || lng < -180 || lng > 180) return 'Longitude must be between -180 and 180.';
    if (isNaN(zoom) || zoom < 0 || zoom > 21) return 'Zoom must be between 0 and 21.';
    if (widthValue <= 0 || isNaN(widthValue)) return 'Width must be positive.';
    if (heightValue <= 0 || isNaN(heightValue)) return 'Height must be positive.';
    for (const marker of markers) {
      if (isNaN(marker.lat) || marker.lat < -90 || marker.lat > 90 || isNaN(marker.lng) || marker.lng < -180 || marker.lng > 180) {
        return `Marker "${marker.title || 'Unnamed'}" has invalid coordinates.`;
      }
    }
    if (styles) {
      try {
        JSON.parse(styles);
      } catch {
        return 'Map styles must be valid JSON.';
      }
    }
    return null;
  }, [mapDescription, lat, lng, zoom, widthValue, heightValue, markers, styles]);

  const handleReverseGeocode = async () => {
    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
      setError('Invalid coordinates for reverse geocoding.');
      return;
    }
    setIsGeocoding(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/reverse-geocode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
      });
      if (!response.ok) throw new Error('Failed to fetch address');
      const data: { address: string } = await response.json();
      setAddress(DOMPurify.sanitize(data.address));
    } catch (err) {
      setError('Failed to reverse geocode coordinates.');
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleAddMarker = () => {
    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
      setError('Current coordinates are invalid for a marker.');
      return;
    }
    setMarkers([...markers, { lat, lng, title: `Marker ${markers.length + 1}` }]);
  };

  const handleEditMarker = (index: number, field: 'lat' | 'lng' | 'title', value: string) => {
    const updatedMarkers = [...markers];
    if (field === 'title') {
      updatedMarkers[index] = { ...updatedMarkers[index], title: DOMPurify.sanitize(value) };
    } else {
      const num = parseFloat(value);
      if (!isNaN(num)) updatedMarkers[index] = { ...updatedMarkers[index], [field]: num };
    }
    setMarkers(updatedMarkers);
  };

  const handleDeleteMarker = (index: number) => {
    setMarkers(markers.filter((_, i) => i !== index));
  };

  const handleDimensionChange = (
    type: 'width' | 'height',
    value: string,
    unit: 'px' | '%'
  ) => {
    const num = parseInt(value);
    if (isNaN(num) || num <= 0) {
      setError(`${type.charAt(0).toUpperCase() + type.slice(1)} must be positive.`);
      return;
    }
    if (type === 'width') {
      setWidthValue(num);
      setWidthUnit(unit);
      setWidth(`${num}${unit}`);
    } else {
      setHeightValue(num);
      setHeightUnit(unit);
      setHeight(`${num}${unit}`);
    }
  };

  const handleSubmit = () => {
    const validationError = validateInputs();
    if (validationError) {
      setError(validationError);
      return;
    }
    onSubmit({
      mapDescription: DOMPurify.sanitize(mapDescription),
      lat,
      lng,
      zoom,
      markers,
      width,
      height,
      mapType,
      styles: styles || undefined,
      trafficLayer,
      transitLayer,
      draggable,
    });
  };

  const staticMapUrl = React.useMemo(() => {
    const markersParam = markers
      .map((m) => `markers=color:red|label:${m.title?.[0] || 'M'}|${m.lat},${m.lng}`)
      .join('&');
    return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=300x200&maptype=${mapType}&${markersParam}&key=${GOOGLE_MAPS_API_KEY}`;
  }, [lat, lng, zoom, markers, mapType]);

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h3 className="text-lg font-semibold mb-4">Add Map</h3>
      {error && (
        <p className="text-red-500 text-sm mb-4" role="alert">
          {error}
        </p>
      )}
      {GOOGLE_MAPS_API_KEY && (
        <div className="mb-4">
          <img
            src={staticMapUrl}
            alt="Map preview"
            className="w-full max-w-[300px] h-[200px] rounded-md border border-gray-200"
            onError={() => setError('Failed to load map preview')}
          />
        </div>
      )}
      <div className="space-y-6">
        <div>
          <label htmlFor="mapDescription" className="block text-sm font-medium text-gray-700">
            Map Description
          </label>
          <input
            id="mapDescription"
            type="text"
            value={mapDescription}
            onChange={(e) => setMapDescription(DOMPurify.sanitize(e.target.value))}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
            placeholder="Enter map description"
            disabled={isLoading || isGeocoding}
            aria-label="Map description"
          />
        </div>
        <div>
          <label htmlFor="address" className="block text-sm font-medium text-gray-700">
            Address
          </label>
          <div className="flex space-x-2">
            <input
              id="address"
              type="text"
              value={address}
              onChange={(e) => {
                const value = DOMPurify.sanitize(e.target.value);
                setAddress(value);
                debouncedGeocode(value);
              }}
              className="flex-1 mt-1 block rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
              placeholder="Enter an address"
              disabled={isLoading || isGeocoding}
              aria-label="Address for geocoding"
            />
            <button
              onClick={handleReverseGeocode}
              disabled={isLoading || isGeocoding}
              className="mt-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition disabled:opacity-50"
              aria-label="Get address from coordinates"
            >
              {isGeocoding ? 'Loading...' : 'From Coords'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="latitude" className="block text-sm font-medium text-gray-700">
              Latitude
            </label>
            <input
              id="latitude"
              type="number"
              value={lat}
              onChange={(e) => {
                const value = parseFloat(e.target.value);
                if (!isNaN(value)) setLat(value);
              }}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
              disabled={isLoading || isGeocoding}
              aria-label="Map latitude"
            />
          </div>
          <div>
            <label htmlFor="longitude" className="block text-sm font-medium text-gray-700">
              Longitude
            </label>
            <input
              id="longitude"
              type="number"
              value={lng}
              onChange={(e) => {
                const value = parseFloat(e.target.value);
                if (!isNaN(value)) setLng(value);
              }}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
              disabled={isLoading || isGeocoding}
              aria-label="Map longitude"
            />
          </div>
        </div>
        <div>
          <label htmlFor="zoom" className="block text-sm font-medium text-gray-700">
            Zoom Level ({zoom})
          </label>
          <input
            id="zoom"
            type="range"
            value={zoom}
            onChange={(e) => setZoom(parseInt(e.target.value))}
            min={0}
            max={21}
            className="mt-1 block w-full"
            disabled={isLoading || isGeocoding}
            aria-label="Map zoom level"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="width" className="block text-sm font-medium text-gray-700">
              Map Width ({width})
            </label>
            <div className="flex items-center space-x-2">
              <input
                id="width"
                type="range"
                value={widthValue}
                onChange={(e) => handleDimensionChange('width', e.target.value, widthUnit)}
                min={100}
                max={widthUnit === 'px' ? 1200 : 100}
                step={10}
                className="mt-1 block w-full"
                disabled={isLoading || isGeocoding}
                aria-label="Map width value"
              />
              <select
                value={widthUnit}
                onChange={(e) => handleDimensionChange('width', widthValue.toString(), e.target.value as 'px' | '%')}
                className="mt-1 rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                disabled={isLoading || isGeocoding}
                aria-label="Map width unit"
              >
                <option value="px">px</option>
                <option value="%">%</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="height" className="block text-sm font-medium text-gray-700">
              Map Height ({height})
            </label>
            <div className="flex items-center space-x-2">
              <input
                id="height"
                type="range"
                value={heightValue}
                onChange={(e) => handleDimensionChange('height', e.target.value, heightUnit)}
                min={100}
                max={heightUnit === 'px' ? 800 : 100}
                step={10}
                className="mt-1 block w-full"
                disabled={isLoading || isGeocoding}
                aria-label="Map height value"
              />
              <select
                value={heightUnit}
                onChange={(e) => handleDimensionChange('height', heightValue.toString(), e.target.value as 'px' | '%')}
                className="mt-1 rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                disabled={isLoading || isGeocoding}
                aria-label="Map height unit"
              >
                <option value="px">px</option>
                <option value="%">%</option>
              </select>
            </div>
          </div>
        </div>
        <div>
          <label htmlFor="mapType" className="block text-sm font-medium text-gray-700">
            Map Type
          </label>
          <select
            id="mapType"
            value={mapType}
            onChange={(e) => setMapType(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
            disabled={isLoading || isGeocoding}
            aria-label="Map type"
          >
            <option value="roadmap">Roadmap</option>
            <option value="satellite">Satellite</option>
            <option value="hybrid">Hybrid</option>
            <option value="terrain">Terrain</option>
          </select>
        </div>
        <div>
          <label htmlFor="styles" className="block text-sm font-medium text-gray-700">
            Map Styles (JSON)
          </label>
          <textarea
            id="styles"
            value={styles}
            onChange={(e) => setStyles(DOMPurify.sanitize(e.target.value))}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
            placeholder='e.g., [{"featureType":"water","elementType":"geometry","stylers":[{"color":"#e9e9e9"}]}]'
            disabled={isLoading || isGeocoding}
            aria-label="Custom map styles in JSON format"
            rows={4}
          />
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Map Options</label>
          <div className="flex items-center">
            <input
              id="trafficLayer"
              type="checkbox"
              checked={trafficLayer}
              onChange={(e) => setTrafficLayer(e.target.checked)}
              className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
              disabled={isLoading || isGeocoding}
              aria-label="Show traffic layer"
            />
            <label htmlFor="trafficLayer" className="ml-2 text-sm text-gray-700">
              Show Traffic Layer
            </label>
          </div>
          <div className="flex items-center">
            <input
              id="transitLayer"
              type="checkbox"
              checked={transitLayer}
              onChange={(e) => setTransitLayer(e.target.checked)}
              className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
              disabled={isLoading || isGeocoding}
              aria-label="Show transit layer"
            />
            <label htmlFor="transitLayer" className="ml-2 text-sm text-gray-700">
              Show Transit Layer
            </label>
          </div>
          <div className="flex items-center">
            <input
              id="draggable"
              type="checkbox"
              checked={draggable}
              onChange={(e) => setDraggable(e.target.checked)}
              className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
              disabled={isLoading || isGeocoding}
              aria-label="Enable map dragging"
            />
            <label htmlFor="draggable" className="ml-2 text-sm text-gray-700">
              Enable Dragging
            </label>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Markers</label>
          <button
            onClick={handleAddMarker}
            disabled={isLoading || isGeocoding}
            className="mt-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition disabled:opacity-50"
            aria-label="Add new marker"
          >
            Add Marker
          </button>
          {markers.length > 0 && (
            <ul className="mt-2 space-y-2">
              {markers.map((marker, index) => (
                <li key={index} className="text-sm text-gray-600 flex items-center space-x-2">
                  <input
                    type="text"
                    value={marker.title || ''}
                    onChange={(e) => handleEditMarker(index, 'title', e.target.value)}
                    className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                    placeholder="Marker title"
                    disabled={isLoading || isGeocoding}
                    aria-label={`Marker ${index + 1} title`}
                  />
                  <input
                    type="number"
                    value={marker.lat}
                    onChange={(e) => handleEditMarker(index, 'lat', e.target.value)}
                    className="w-24 rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                    disabled={isLoading || isGeocoding}
                    aria-label={`Marker ${index + 1} latitude`}
                  />
                  <input
                    type="number"
                    value={marker.lng}
                    onChange={(e) => handleEditMarker(index, 'lng', e.target.value)}
                    className="w-24 rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm"
                    disabled={isLoading || isGeocoding}
                    aria-label={`Marker ${index + 1} longitude`}
                  />
                  <button
                    onClick={() => handleDeleteMarker(index)}
                    className="text-red-500 hover:text-red-700"
                    disabled={isLoading || isGeocoding}
                    aria-label={`Delete marker ${index + 1}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={handleSubmit}
          disabled={isLoading || isGeocoding}
          className="w-full px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition disabled:opacity-50"
          aria-label="Add map to website"
        >
          {isLoading || isGeocoding ? 'Loading...' : 'Add Map'}
        </button>
      </div>
    </div>
  );
});

export default MapInput;