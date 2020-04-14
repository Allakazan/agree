import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';

import Blob from './Blob';

export default function CanvasAnimation() {
    const ref = useRef()
    const [width, height] = useWindowSize();

    useEffect(() => {
        let canvas = ref.current;
        let animateFrameRequest;
        const blob = new Blob(canvas.getContext("2d"));

        function loop() {
            blob.context.clearRect(0, 0, canvas.width, canvas.height);
            blob.update();
            animateFrameRequest = window.requestAnimationFrame(loop);
        }
        loop();

        return () => window.cancelAnimationFrame(animateFrameRequest);
    }, []);

    /** Custom window resize listener hook */
    function useWindowSize() {
        const [size, setSize] = useState([0, 0]);
        useLayoutEffect(() => {
            function updateSize() {
                setSize([window.innerWidth, window.innerHeight]);
            }
            window.addEventListener('resize', updateSize);
            updateSize();
            return () => window.removeEventListener('resize', updateSize);
        }, []);
        return size;
    }
    
    return (
        <canvas className="blobCanvas" width={width} height={height} ref={ref}></canvas>
    );
  }
  