# WaveformPlaylist

Playlist and chapter navigation for [WaveformPlayer](https://github.com/arraypress/waveform-player). Zero-config, lightweight, and perfect for podcasts, courses, and music playlists.

## Features

- 🎵 **Multiple track support** - Create playlists with seamless track switching
- 📍 **Chapter navigation** - Add clickable timestamps to any track
- 🎨 **Smart markers** - Chapters automatically appear on waveform for single tracks
- 🖼️ **Artwork support** - Display album/episode artwork in track list
- ▶️ **Play state indicators** - Visual feedback for currently playing track
- ⌨️ **Keyboard shortcuts** - Navigate with N/P and number keys
- 📱 **Responsive** - Works perfectly on all devices
- 🎯 **Two layouts** - List view or minimal button layout
- 🪶 **Lightweight** - ~4KB gzipped (JS + CSS)

## Installation

### NPM
```bash
npm install @arraypress/waveform-player @arraypress/waveform-playlist
```

### CDN
```html
<!-- WaveformPlayer (required) -->
<link rel="stylesheet" href="https://unpkg.com/@arraypress/waveform-player@latest/dist/waveform-player.css">
<script src="https://unpkg.com/@arraypress/waveform-player@latest/dist/waveform-player.js"></script>

<!-- WaveformPlaylist -->
<link rel="stylesheet" href="https://unpkg.com/@arraypress/waveform-playlist@latest/dist/waveform-playlist.css">
<script src="https://unpkg.com/@arraypress/waveform-playlist@latest/dist/waveform-playlist.js"></script>
```

## Quick Start

### Podcast with Chapters
```html
<div data-waveform-playlist>
  <div data-track 
       data-url="episode.mp3" 
       data-title="Episode 42: AI Revolution"
       data-subtitle="with Dr. Sarah Chen"
       data-artwork="episode-cover.jpg">
    <div data-chapter data-time="0:00">Introduction</div>
    <div data-chapter data-time="5:30">Main Topic</div>
    <div data-chapter data-time="45:00">Q&A Session</div>
  </div>
</div>
```

### Music Playlist with Artwork
```html
<div data-waveform-playlist 
     data-continuous="true"
     data-show-play-state="true">
  <div data-track 
       data-url="song1.mp3" 
       data-title="Summer Vibes"
       data-subtitle="Beach Sounds"
       data-artwork="cover1.jpg"
       data-duration="3:45"></div>
  <div data-track 
       data-url="song2.mp3" 
       data-title="Night Drive"
       data-subtitle="Synthwave Mix"
       data-artwork="cover2.jpg"
       data-duration="4:12"></div>
</div>
```

### Course Modules with Chapters
```html
<div data-waveform-playlist 
     data-continuous="true"
     data-expand-chapters="true">
  <div data-track 
       data-url="lesson1.mp3" 
       data-title="Module 1: Introduction"
       data-subtitle="Getting Started">
    <div data-chapter data-time="0:00">Welcome</div>
    <div data-chapter data-time="10:00">Setup</div>
  </div>
  <div data-track 
       data-url="lesson2.mp3" 
       data-title="Module 2: Core Concepts">
    <div data-chapter data-time="0:00">Theory</div>
    <div data-chapter data-time="15:00">Practice</div>
  </div>
</div>
```

### Minimal Button Layout
```html
<div data-waveform-playlist data-layout="minimal">
  <div data-track data-url="beat1.mp3" data-title="Trap Beat"></div>
  <div data-track data-url="beat2.mp3" data-title="Lo-Fi"></div>
  <div data-track data-url="beat3.mp3" data-title="Boom Bap"></div>
</div>
```

## Configuration

### Container Attributes

All WaveformPlayer options can be set on the container and will be inherited:

```html
<div data-waveform-playlist
     data-waveform-style="mirror"
     data-height="80"
     data-bar-width="2"
     data-progress-color="rgba(168, 85, 247, 0.9)"
     data-show-playback-speed="true">
  <!-- tracks here -->
</div>
```

### Playlist Options

| Attribute | Default | Description |
|-----------|---------|-------------|
| `data-layout` | `"list"` | Layout style: `"list"` or `"minimal"` |
| `data-continuous` | `false` | Auto-play next track when one ends |
| `data-expand-chapters` | `true` | Show chapters under tracks in multi-track lists |
| `data-show-duration` | `true` | Display track durations |
| `data-show-play-state` | `true` | Show play/pause overlay on artwork |
| `data-show-chapter-markers` | `null` | Show chapters as waveform markers (smart default) |
| `data-chapter-marker-color` | `rgba(168, 85, 247, 0.8)` | Default color for chapter markers |

### Track Attributes

| Attribute | Description |
|-----------|-------------|
| `data-url` | Audio file URL (required) |
| `data-title` | Track title |
| `data-subtitle` | Artist or description |
| `data-artwork` | Album artwork URL |
| `data-album` | Album name (for Media Session API) |
| `data-duration` | Display duration (e.g., "3:45") |
| `data-markers` | JSON array of waveform markers (separate from chapters) |

### Chapter Attributes

| Attribute | Description |
|-----------|-------------|
| `data-time` | Timestamp (e.g., "1:30" or "0:00") |
| `data-color` | Optional marker color for this chapter |

## JavaScript API

```javascript
// Create instance programmatically
const playlist = new WaveformPlaylist('#my-playlist', {
    continuous: true,
    expandChapters: true,
    showPlayState: true
});

// Navigate tracks
playlist.nextTrack();
playlist.previousTrack();
playlist.selectTrack(2);

// Seek to chapter
playlist.seekToChapter(trackIndex, timeInSeconds);

// Get current state
const player = playlist.getPlayer();
const trackIndex = playlist.getCurrentTrackIndex();
const tracks = playlist.getTracks();

// Destroy
playlist.destroy();
```

## Keyboard Shortcuts

- **N** - Next track
- **P** - Previous track
- **1-9** - Jump to track by number
- **Space** - Play/Pause (when focused)
- **←/→** - Seek (via WaveformPlayer)
- **↑/↓** - Volume (via WaveformPlayer)

## Smart Defaults

The library intelligently adapts based on your content:

- **Single track with chapters**: Shows chapters as both navigation list AND waveform markers
- **Multiple tracks**: Shows track list, chapters expand under active track, no waveform markers
- **Minimal layout**: Shows compact button switcher

## Styling

The library provides minimal, semantic HTML that's easy to style:

```css
/* Custom styling example */
.waveform-playlist {
  background: #1a1a1a;
  border-radius: 12px;
  padding: 1rem;
}

.wp-item {
  padding: 1rem;
  border-radius: 8px;
}

.wp-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.wp-item.wp-active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.wp-artwork {
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
```

## Use Cases

### 📻 Podcasts
- Episode chapters with visual timeline
- Clickable timestamps in show notes
- Sponsor segment navigation

### 🎓 Online Courses
- Module/lesson organization
- Chapter breakdowns within lessons
- Visual progress through content

### 🎵 Music & Audio
- Album track listings with artwork
- Beat/sample showcases
- DJ mix tracklists

### 📖 Audiobooks
- Chapter navigation
- Section bookmarks
- Visual timeline of book structure

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers

## License

MIT © [ArrayPress](https://github.com/arraypress)

## Related

- [WaveformPlayer](https://github.com/arraypress/waveform-player) - The core audio player with waveform visualization