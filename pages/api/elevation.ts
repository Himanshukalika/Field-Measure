import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { points, apiKey } = req.body;

    // Call Google Maps Elevation API
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/elevation/json?locations=${
        points.map((p: { lat: number; lng: number }) => `${p.lat},${p.lng}`).join('|')
      }&key=${apiKey}`
    );

    const data = await response.json();

    if (data.status === 'OK') {
      return res.status(200).json(data);
    } else {
      throw new Error(data.error_message || 'Failed to get elevation data');
    }

  } catch (error) {
    console.error('Elevation API error:', error);
    return res.status(500).json({ 
      message: 'Failed to fetch elevation data',
      error: error.message 
    });
  }
}