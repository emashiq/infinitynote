import { PinnedSection } from './PinnedSection';
import { QuickActions } from './QuickActions';
import { RecentSection } from './RecentSection';
import { ScopeFilter } from './ScopeFilter';

export function HomeView() {
  return (
    <div className="home">
      <div className="home-header">
        <h2 className="view-title">Home</h2>
        <ScopeFilter />
      </div>
      <QuickActions />
      <PinnedSection />
      <RecentSection />
    </div>
  );
}
