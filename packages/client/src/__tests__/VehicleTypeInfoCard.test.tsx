import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VehicleTypeInfoCard } from '../components/journey/VehicleTypeInfoCard';
import { VehicleType } from '@bimoto/shared';
import './setup';

describe('VehicleTypeInfoCard', () => {
  test('renders BIKE with 12 km/h, no helmet, small package', () => {
    render(<VehicleTypeInfoCard vehicleType={VehicleType.BIKE} />);
    expect(screen.getByText(/Bicycle/i)).toBeInTheDocument();
    expect(screen.getByText(/~12 km\/h/)).toBeInTheDocument();
    expect(screen.getByText(/No helmet needed/)).toBeInTheDocument();
    expect(screen.getByText(/Small packages only/)).toBeInTheDocument();
    expect(screen.getByText(/Lower fare/)).toBeInTheDocument();
  });

  test('renders E_BIKE with 18 km/h, no helmet, moderate fare', () => {
    render(<VehicleTypeInfoCard vehicleType={VehicleType.E_BIKE} />);
    expect(screen.getByText(/Electric bicycle/i)).toBeInTheDocument();
    expect(screen.getByText(/~18 km\/h/)).toBeInTheDocument();
    expect(screen.getByText(/No helmet needed/)).toBeInTheDocument();
    expect(screen.getByText(/Moderate fare/)).toBeInTheDocument();
  });

  test('renders MOTO with helmet-required notice and standard fare', () => {
    render(<VehicleTypeInfoCard vehicleType={VehicleType.MOTO} />);
    expect(screen.getByText(/Motorcycle/i)).toBeInTheDocument();
    expect(screen.getByText(/~25 km\/h/)).toBeInTheDocument();
    expect(screen.getByText(/Helmet required/)).toBeInTheDocument();
    expect(screen.getByText(/Standard fare/)).toBeInTheDocument();
    expect(screen.getByText(/Medium packages/)).toBeInTheDocument();
  });

  test('renders E_MOTO with helmet-required + electric premium fare', () => {
    render(<VehicleTypeInfoCard vehicleType={VehicleType.E_MOTO} />);
    expect(screen.getByText(/Electric motorcycle/i)).toBeInTheDocument();
    expect(screen.getByText(/~28 km\/h/)).toBeInTheDocument();
    expect(screen.getByText(/Helmet required/)).toBeInTheDocument();
    expect(screen.getByText(/Slightly above standard/)).toBeInTheDocument();
  });

  test('returns null for null vehicleType (defensive)', () => {
    const { container } = render(<VehicleTypeInfoCard vehicleType={null} />);
    expect(container.firstChild).toBeNull();
  });

  test('returns null for undefined vehicleType (defensive)', () => {
    const { container } = render(<VehicleTypeInfoCard vehicleType={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
