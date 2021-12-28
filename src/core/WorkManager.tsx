import React, {
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useContext
} from 'react';
import { useThree } from '@react-three/fiber';

const WORK_PER_FRAME = 2;

export type WorkCallback = (gl: THREE.WebGLRenderer) => void;
type WorkManagerHook = (callback: WorkCallback | null) => void;
export const WorkManagerContext = React.createContext<WorkManagerHook | null>(
  null
);

interface RendererJobInfo {
  id: number;
  callbackRef: React.MutableRefObject<WorkCallback | null>;
}

// this runs inside the renderer hook instance
function useJobInstance(
  jobCountRef: React.MutableRefObject<number>,
  jobs: RendererJobInfo[],
  callback: WorkCallback | null
) {
  // unique job ID
  const jobId = useMemo<number>(() => {
    // generate new job ID on mount
    jobCountRef.current += 1;
    return jobCountRef.current;
  }, [jobCountRef]);

  // wrap latest callback in stable ref
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  // add or update job object (preserving the order)
  useEffect(() => {
    const jobInfo = {
      id: jobId,
      callbackRef
    };

    const jobIndex = jobs.findIndex((job) => job.id === jobId);
    if (jobIndex === -1) {
      jobs.push(jobInfo);
    } else {
      jobs[jobIndex] = jobInfo;
    }

    // clean up on unmount
    return () => {
      // remove job object with our ID
      const currentJobIndex = jobs.findIndex((job) => job.id === jobId);
      if (currentJobIndex !== -1) {
        jobs.splice(currentJobIndex, 1);
      }
    };
  }, [jobId, jobs]);
}

function createRAF(cb: () => void) {
  const signal = { stop: false };

  function frame() {
    if (signal.stop) {
      return;
    }

    cb();
    requestAnimationFrame(frame);
  }

  // kick off first frame
  requestAnimationFrame(frame);

  return signal;
}

export function useWorkManager(cb: WorkCallback | null) {
  // get the work manager hook
  const hook = useContext(WorkManagerContext);
  if (hook === null) {
    throw new Error('expected work manager');
  }

  hook(cb);
}

// this simply acts as a central spot to schedule per-frame work
// (allowing eventual possibility of e.g. multiple unrelated renderers co-existing within a single central work manager)
const WorkManager: React.FC = ({ children }) => {
  const jobCountRef = useRef(0);
  const jobsRef = useRef<RendererJobInfo[]>([]);

  const hook = useCallback<WorkManagerHook>((callback) => {
    useJobInstance(jobCountRef, jobsRef.current, callback); // eslint-disable-line react-hooks/rules-of-hooks
  }, []);

  // actual per-frame work invocation
  const { gl } = useThree();
  useEffect(() => {
    const signal = createRAF(() => {
      // get active job, if any
      const activeJob = jobsRef.current.find(
        (job) => !!job.callbackRef.current
      );

      // check if there is nothing to do
      if (!activeJob) {
        return;
      }

      // invoke work callback
      for (let i = 0; i < WORK_PER_FRAME; i += 1) {
        // check if callback is still around (might go away mid-batch)
        const callback = activeJob.callbackRef.current;

        if (!callback) {
          return;
        }

        callback(gl);
      }
    });

    return () => {
      signal.stop = true;
    };
  }, [gl]);

  return (
    <>
      <WorkManagerContext.Provider value={hook}>
        {children}
      </WorkManagerContext.Provider>
    </>
  );
};

export default WorkManager;
