Complete Updated FlixHQ Scraper

import { load } from 'cheerio';

import {
  MovieParser,
  TvType,
  IMovieInfo,
  IEpisodeServer,
  StreamingServers,
  ISource,
  IMovieResult,
  ISearch,
} from '../../models';
import { MixDrop, VidCloud } from '../../extractors';

class FlixHQ extends MovieParser {
  override readonly name = 'FlixHQ';
  protected override baseUrl = 'https://flixhq.to';
  protected override logo = 'https://img.flixhq.to/xxrz/400x400/100/ab/5f/ab5f0e1996cc5b71919e10e910ad593e/ab5f0e1996cc5b71919e10e910ad593e.png';
  protected override classPath = 'MOVIES.FlixHQ';
  override supportedTypes = new Set([TvType.MOVIE, TvType.TVSERIES]);

  /**
   * Extract source ID from watch URL
   */
  private extractSourceId = (watchUrl: string): { mediaId: string; sourceId: string } => {
    const parts = watchUrl.split('.');
    const mediaId = parts[0].split('-').pop() || '';
    const sourceId = parts[1] || '';
    return { mediaId, sourceId };
  };

  /**
   * Search for movies/shows
   */
  override search = async (query: string, page: number = 1): Promise<ISearch<IMovieResult>> => {
    const searchResult: ISearch<IMovieResult> = {
      currentPage: page,
      hasNextPage: false,
      results: [],
    };
    try {
      const { data } = await this.client.get(
        `${this.baseUrl}/search/${query.replace(/[\W_]+/g, '-')}?page=${page}`
      );

      const $ = load(data);

      const navSelector = 'div.pre-pagination:nth-child(3) > nav:nth-child(1) > ul:nth-child(1)';

      searchResult.hasNextPage =
        $(navSelector).length > 0 ? !$(navSelector).children().last().hasClass('active') : false;

      $('.film_list-wrap > div.flw-item').each((i, el) => {
        const releaseDate = $(el).find('div.film-detail > div.fd-infor > span:nth-child(1)').text();
        searchResult.results.push({
          id: $(el).find('div.film-poster > a').attr('href')?.slice(1)!,
          title: $(el).find('div.film-detail > h2 > a').attr('title')!,
          url: `${this.baseUrl}${$(el).find('div.film-poster > a').attr('href')}`,
          image: $(el).find('div.film-poster > img').attr('data-src'),
          releaseDate: isNaN(parseInt(releaseDate)) ? undefined : releaseDate,
          seasons: releaseDate.includes('SS') ? parseInt(releaseDate.split('SS')[1]) : undefined,
          type:
            $(el).find('div.film-detail > div.fd-infor > span.float-right').text() === 'Movie'
              ? TvType.MOVIE
              : TvType.TVSERIES,
        });
      });

      return searchResult;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  /**
   * Fetch media info
   */
  override fetchMediaInfo = async (mediaId: string): Promise<IMovieInfo> => {
    if (!mediaId.startsWith(this.baseUrl)) {
      mediaId = `${this.baseUrl}/${mediaId}`;
    }

    // Extract the media ID from the URL if needed
    if (mediaId.includes('watch-')) {
      const { mediaId: id } = this.extractSourceId(mediaId);
      mediaId = id;
    }

    const movieInfo: IMovieInfo = {
      id: mediaId,
      title: '',
      url: `${this.baseUrl}/movie/${mediaId}`,
    };

    try {
      const { data } = await this.client.get(movieInfo.url);
      const $ = load(data);

      movieInfo.cover = $('div.w_b-cover').attr('style')?.slice(22).replace(')', '').replace(';', '');
      movieInfo.title = $('.heading-name > a:nth-child(1)').text();
      movieInfo.image = $('.m_i-d-poster > div:nth-child(1) > img:nth-child(1)').attr('src');
      movieInfo.description = $('.description').text();
      movieInfo.type = movieInfo.url.includes('/movie/') ? TvType.MOVIE : TvType.TVSERIES;
      movieInfo.releaseDate = $('div.row-line:nth-child(3)').text().replace('Released: ', '').trim();
      movieInfo.genres = $('div.row-line:nth-child(2) > a')
        .map((i, el) => $(el).text().split('&'))
        .get()
        .map(v => v.trim());
      movieInfo.casts = $('div.row-line:nth-child(5) > a')
        .map((i, el) => $(el).text())
        .get();
      movieInfo.tags = $('div.row-line:nth-child(6) > h2')
        .map((i, el) => $(el).text())
        .get();
      movieInfo.production = $('div.row-line:nth-child(4) > a:nth-child(2)').text();
      movieInfo.country = $('div.row-line:nth-child(1) > a:nth-child(2)').text();
      movieInfo.duration = $('span.item:nth-child(3)').text();
      movieInfo.rating = parseFloat($('span.item:nth-child(2)').text());

      // Get episode/server information
      const servers = await this.fetchEpisodeServers(mediaId);
      
      if (movieInfo.type === TvType.TVSERIES) {
        movieInfo.episodes = servers.map((server, index) => {
          const { sourceId } = this.extractSourceId(server.url);
          return {
            id: sourceId,
            title: `Episode ${index + 1}`,
            url: server.url,
          };
        });
      } else if (servers.length > 0) {
        const { sourceId } = this.extractSourceId(servers[0].url);
        movieInfo.episodes = [{
          id: sourceId,
          title: movieInfo.title,
          url: servers[0].url,
        }];
      }

      return movieInfo;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  /**
   * Fetch episode sources
   */
  override fetchEpisodeSources = async (
    episodeId: string,
    mediaId: string,
    server: StreamingServers = StreamingServers.UpCloud
  ): Promise<ISource> => {
    if (episodeId.startsWith('http')) {
      const serverUrl = new URL(episodeId);
      switch (server) {
        case StreamingServers.MixDrop:
          return {
            headers: { Referer: serverUrl.href },
            sources: await new MixDrop(this.proxyConfig, this.adapter).extract(serverUrl),
          };
        case StreamingServers.VidCloud:
          return {
            headers: { Referer: serverUrl.href },
            ...(await new VidCloud(this.proxyConfig, this.adapter).extract(serverUrl, true)),
          };
        case StreamingServers.UpCloud:
          return {
            headers: { Referer: serverUrl.href },
            ...(await new VidCloud(this.proxyConfig, this.adapter).extract(serverUrl)),
          };
        default:
          return {
            headers: { Referer: serverUrl.href },
            sources: await new MixDrop(this.proxyConfig, this.adapter).extract(serverUrl),
          };
      }
    }

    try {
      // Get servers list
      const servers = await this.fetchEpisodeServers(mediaId);
      const serverItem = servers.find(s => s.name.toLowerCase() === server.toLowerCase());
      
      if (!serverItem) {
        throw new Error(`Server ${server} not found`);
      }

      // Extract source ID from the server URL
      const { sourceId } = this.extractSourceId(serverItem.url);
      
      if (!sourceId) {
        throw new Error('Source ID not found');
      }

      // Get the source using the new endpoint
      const { data: sourceData } = await this.client.get(
        `${this.baseUrl}/ajax/episode/sources/${sourceId}`
      );

      if (!sourceData?.link) {
        throw new Error('No source found');
      }

      const serverUrl = new URL(sourceData.link);
      return await this.fetchEpisodeSources(serverUrl.href, mediaId, server);
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  /**
   * Fetch episode servers
   */
  override fetchEpisodeServers = async (mediaId: string): Promise<IEpisodeServer[]> => {
    try {
      const { data: episodeData } = await this.client.get(
        `${this.baseUrl}/ajax/episode/list/${mediaId}`
      );
      const $ = load(episodeData);

      const servers: IEpisodeServer[] = [];

      $('.nav-item').each((_, el) => {
        const $server = $(el);
        const $link = $server.find('a');
        const name = $link.text().toLowerCase().trim();
        const url = $link.attr('href') || '';

        if (name && url) {
          servers.push({
            name: name.replace('server ', ''),
            url: `${this.baseUrl}${url}`
          });
        }
      });

      return servers;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  /**
   * Fetch recent movies
   */
  fetchRecentMovies = async (): Promise<IMovieResult[]> => {
    try {
      const { data } = await this.client.get(`${this.baseUrl}/home`);
      const $ = load(data);

      const movies = $(
        'section.block_area:contains("Latest Movies") > div:nth-child(2) > div:nth-child(1) > div.flw-item'
      )
        .map((i, el) => {
          const releaseDate = $(el).find('div.film-detail > div.fd-infor > span:nth-child(1)').text();
          const movie: any = {
            id: $(el).find('div.film-poster > a').attr('href')?.slice(1)!,
            title: $(el).find('div.film-detail > h3.film-name > a').attr('title')!,
            url: `${this.baseUrl}${$(el).find('div.film-poster > a').attr('href')}`,
            image: $(el).find('div.film-poster > img').attr('data-src'),
            releaseDate: isNaN(parseInt(releaseDate)) ? undefined : releaseDate,
            duration: $(el).find('div.film-detail > div.fd-infor > span.fdi-duration').text() || null,
            type: TvType.MOVIE,
          };
          return movie;
        })
        .get();
      return movies;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  /**
   * Fetch recent TV shows
   */
  fetchRecentTvShows = async (): Promise<IMovieResult[]> => {
    try {
      const { data } = await this.client.get(`${this.baseUrl}/home`);
      const $ = load(data);

      const tvshows = $(
        'section.block_area:contains("Latest TV Shows") > div:nth-child(2) > div:nth-child(1) > div.flw-item'
      )
        .map((i, el) => {
          const tvshow = {
            id: $(el).find('div.film-poster > a').attr('href')?.slice(1)!,
            title: $(el).find('div.film-detail > h3.film-name > a').attr('title')!,
            url: `${this.baseUrl}${$(el).find('div.film-poster > a').attr('href')}`,
            image: $(el).find('div.film-poster > img').attr('data-src'),
            season: $(el).find('div.film-detail > div.fd-infor > span:nth-child(1)').text(),
            latestEpisode: $(el).find('div.film-detail > div.fd-infor > span:nth-child(3)').text() || null,
            type: TvType.TVSERIES,
          };
          return tvshow;
        })
        .get();
      return tvshows;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  /**
   * Fetch trending movies
   */
  fetchTrendingMovies = async (): Promise<IMovieResult[]> => {
    try {
      const { data } = await this.client.get(`${this.baseUrl}/home`);
      const $ = load(data);

      const movies = $('div#trending-movies div.film_list-wrap div.flw-item')
        .map((i, el) => {
          const releaseDate = $(el).find('div.film-detail > div.fd-infor > span:nth-child(1)').text();
          const movie: any = {
            id: $(el).find('div.film-poster > a').attr('href')?.slice(1)!,
            title: $(el).find('div.film-detail > h3.film-name > a').attr('title')!,
            url: `${this.baseUrl}${$(el).find('div.film-poster > a').attr('href')}`,
            image: $(el).find('div.film-poster > img').attr('data-src'),
            releaseDate: isNaN(parseInt(releaseDate)) ? undefined : releaseDate,
            duration: $(el).find('div.film-detail > div.fd-infor > span.fdi-duration').text() || null,
            type: TvType.MOVIE,
          };
          return movie;
        })
        .get();
      return movies;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  /**
   * Fetch trending TV shows
   */
  fetchTrendingTvShows = async (): Promise<IMovieResult[]> => {
    try {
      const { data } = await this.client.get(`${this.baseUrl}/home`);
      const $ = load(data);

      const tvshows = $('div#trending-tv div.film_list-wrap div.flw-item')
        .map((i, el) => {
          const tvshow = {
            id: $(el).find('div.film-poster > a').attr('href')?.slice(1)!,
            title: $(el).find('div.film-detail > h3.film-name > a').attr('title')!,
            url: `${this.baseUrl}${$(el).find('div.film-poster > a').attr('href')}`,
            image: $(el).find('div.film-poster > img').attr('data-src'),
            season: $(el).find('div.film-detail > div.fd-infor > span:nth-child(1)').text(),
            latestEpisode: $(el).find('div.film-detail > div.fd-infor > span:nth-child(3)').text() || null,
            type: TvType.TVSERIES,
          };
          return tvshow;
        })
        .get();
      return tvshows;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  /**
   * Fetch content by country
   */
  fetchByCountry = async (country: string, page: number = 1): Promise<ISearch<IMovieResult>> => {
    const result: ISearch<IMovieResult> = {
      currentPage: page,
      hasNextPage: false,
      results: [],
    };
    const navSelector = 'div.pre-pagination:nth-child(3) > nav:nth-child(1) > ul:nth-child(1)';

    try {
      const { data } = await this.client.get(`${this.baseUrl}/country/${country}/?page=${page}`);
      const $ = load(data);

      result.hasNextPage =
        $(navSelector).length > 0 ? !$(navSelector).children().last().hasClass('active') : false;

      $('div.container > section.block_area > div.block_area-content > div.film_list-wrap > div.flw-item')
        .each((i, el) => {
          const resultItem: IMovieResult = {
            id: $(el).find('div.film-poster > a').attr('href')?.slice(1) ?? '',
            title: $(el).find('div.film-detail > h2.film-name > a').attr('title') ?? '',
            url: `${this.baseUrl}${$(el).find('div.film-poster > a').attr('href')}`,
            image: $(el).find('div.film-poster > img').attr('data-src'),
            type:
              $(el).find('div.film-detail > div.fd-infor > span.float-right').text() === 'Movie'
                ? TvType.MOVIE
                : TvType.TVSERIES,
          };
          const season = $(el).find('div.film-detail > div.fd-infor > span:nth-child(1)').text();
          const latestEpisode =
            $(el).find('div.film-detail > div.fd-infor > span:nth-child(3)').text() ?? null;
          if (resultItem.type === TvType.TVSERIES) {
            resultItem.season = season;
            resultItem.latestEpisode = latestEpisode;
          } else {
            resultItem.releaseDate = season;
            resultItem.duration = latestEpisode;
          }
          result.results.push(resultItem);
        })
        .get();
      return result;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  /**
   * Fetch content by genre
   */
  fetchByGenre = async (genre: string, page: number = 1): Promise<ISearch<IMovieResult>> => {
    const result: ISearch<IMovieResult> = {
      currentPage: page,
      hasNextPage: false,
      results: [],
    };
    try {
      const { data } = await this.client.get(`${this.baseUrl}/genre/${genre}?page=${page}`);
      const $ = load(data);

      const navSelector = 'div.pre-pagination:nth-child(3) > nav:nth-child(1) > ul:nth-child(1)';

      result.hasNextPage =
        $(navSelector).length > 0 ? !$(navSelector).children().last().hasClass('active') : false;

      $('.film_list-wrap > div.flw-item')
        .each((i, el) => {
          const resultItem: IMovieResult = {
            id: $(el).find('div.film-poster > a').attr('href')?.slice(1) ?? '',
            title: $(el).find('div.film-detail > h2 > a').attr('title') ?? '',
            url: `${this.baseUrl}${$(el).find('div.film-poster > a').attr('href')}`,
            image: $(el).find('div.film-poster > img').attr('data-src'),
            type:
              $(el).find('div.film-detail > div.fd-infor > span.float-right').text() === 'Movie'
                ? TvType.MOVIE
                : TvType.TVSERIES,
          };
          const season = $(el).find('div.film-detail > div.fd-infor > span:nth-child(1)').text();
          const latestEpisode =
            $(el).find('div.film-detail > div.fd-infor > span:nth-child(3)').text() ?? null;
          if (resultItem.type === TvType.TVSERIES) {
            resultItem.season = season;
            resultItem.latestEpisode = latestEpisode;
          } else {
            resultItem.releaseDate = season;
            resultItem.duration = latestEpisode;
          }
          result.results.push(resultItem);
        })
        .get();

      return result;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  /**
   * Helper method to test the scraper
   */
  static async test() {
    const flixhq = new FlixHQ();
    
    // Test search
    const searchResults = await flixhq.search('Joker');
    console.log('Search Results:', searchResults);

    if (searchResults.results.length > 0) {
      // Test media info
      const mediaInfo = await flixhq.fetchMediaInfo(searchResults.results[0].id);
      console.log('Media Info:', mediaInfo);

      // Test episode sources
      if (mediaInfo.episodes && mediaInfo.episodes.length > 0) {
        const sources = await flixhq.fetchEpisodeSources(
          mediaInfo.episodes[0].id,
          mediaInfo.id,
          StreamingServers.UpCloud
        );
        console.log('Sources:', sources);
      }
    }
  }
}

// Test code (commented out)
// (async () => {
//   await FlixHQ.test();
// })();

export default FlixHQ;
