import { useState } from 'react';
import type { HomeScopeType } from '../../shared/contracts/home';
import { useServices, useStore } from '../state/use-store';
import { SegmentedControl } from '../ui/SegmentedControl';

type Kind = 'all' | 'common' | 'project';

export function ScopeFilter() {
  const { home, tree } = useServices();
  const { scope } = useStore(home.store);
  const { snapshot } = useStore(tree.store);
  const [lastProject, setLastProject] = useState<string | null>(scope.kind === 'project' ? scope.projectId : null);
  if (scope.kind === 'project' && lastProject !== scope.projectId) setLastProject(scope.projectId);

  const projects = [...snapshot.projects].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  const noProjects = projects.length === 0;

  const choose = (kind: Kind) => {
    let next: HomeScopeType;
    if (kind === 'project') {
      const id = projects.find((p) => p.id === lastProject)?.id ?? projects[0]?.id;
      if (!id) return;
      next = { kind: 'project', projectId: id };
    } else next = { kind };
    void home.setScope(next);
  };

  return (
    <div className="scope-filter">
      <SegmentedControl<Kind>
        label="Show notes from"
        name="home-scope"
        value={scope.kind}
        onChange={choose}
        options={[
          { value: 'all', label: 'All' },
          { value: 'common', label: 'Common' },
          { value: 'project', label: 'Project', disabled: noProjects, title: noProjects ? 'Create a project first' : undefined },
        ]}
      />
      {scope.kind === 'project' ? (
        <select
          aria-label="Project"
          className="select"
          value={scope.projectId}
          onChange={(e) => void home.setScope({ kind: 'project', projectId: e.target.value })}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
