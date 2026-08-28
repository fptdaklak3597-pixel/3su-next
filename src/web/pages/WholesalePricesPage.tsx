import { useNavigate } from 'react-router-dom'
import { WholesalePricesPanel } from '@/shared/WholesalePricesPanel'

export function WebWholesalePricesPage() {
  const navigate = useNavigate()
  return <WholesalePricesPanel variant="web" onBack={() => navigate('/kho')} />
}
