// The home page: a platter cooling in 3D, and the usual schedule against Quartzline's.
import { PRESETS, clayById, coneById, defaultSetup, toFile } from '../engine/index.js';
import { Engine } from './client.js';
import { PotScene } from './pot3d.js';
import { $, chance, hours, reduced } from './ui.js';
const setup = defaultSetup('plate');
setup.piece = { ...PRESETS.plate, diameter: 0.36, height: 0.04, wall: 0.008, base: 0.011 };
setup.cone = coneById('6');
const strength = clayById('stoneware').strength;
const engine = new Engine();
const scene = new PotScene($('hero-stage'));
scene.spin = true;
async function main() {
    const r = await engine.run(toFile(setup), false);
    scene.setPot(r.shape, r.layers);
    const f = r.mine;
    $('usual-chance').textContent = chance(f.chance);
    $('usual-detail').textContent = `chance of a crack, at the ${f.worst.region} as it cools through quartz; ${hours(f.duration)}`;
    // Loop through the cooling, from the top of the firing down past quartz.
    const top = f.air.indexOf(Math.max(...f.air));
    const end = Math.min(f.frames.length - 1, f.air.findIndex((a, i) => i > top && a < 380));
    let k = Math.max(top, 0);
    const at = (i) => scene.show(f.frames[i], 'stress', strength, f.air[i]);
    if (reduced()) {
        let w = top;
        for (let i = top; i <= end; i++)
            if (Math.abs(f.times[i] - f.worst.time) < Math.abs(f.times[w] - f.worst.time))
                w = i;
        at(w);
    }
    else {
        setInterval(() => {
            at(k);
            k = k >= end ? top : k + 1;
        }, 90);
    }
    document.body.dataset.ready = '1';
    const p = await engine.run(toFile(setup), true);
    if (p.planned) {
        $('plan-chance').textContent = chance(p.planned.firing.chance);
        const saved = f.duration - p.planned.firing.duration;
        $('plan-detail').textContent = `chance of a crack; ${hours(p.planned.firing.duration)}${saved > 60 ? `, ${hours(saved)} quicker` : ''}`;
    }
}
main().catch(() => {
    $('hero-caption').textContent = "The 3D view couldn't start in this browser.";
});
