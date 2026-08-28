import { useNavigate } from 'react-router-dom'
import { WholesalePricesPanel } from '@/shared/WholesalePricesPanel'

export function WholesalePricesPage() {
  const navigate = useNavigate()
  return <WholesalePricesPanel variant="mobile" onBack={() => navigate('/kho')} />
}
