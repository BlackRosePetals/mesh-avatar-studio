import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { MeshAvatar } from '../../packages/react/src/index';
import { mount } from './react-harness';
mount(React, createRoot, MeshAvatar);
