import Phaser from "phaser";
import { DuelScene } from "./scenes/DuelScene";
import "./styles/main.css";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game-root",
  width: 1280,
  height: 720,
  backgroundColor: "#07080f",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [DuelScene],
  render: {
    antialias: true,
    pixelArt: false
  }
};

new Phaser.Game(config);
