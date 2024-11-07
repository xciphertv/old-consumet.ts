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
   * @param query search query
   * @param page page number (default 1)
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
   * @param mediaId media id or full URL
   */
  override fetchMediaInfo = async (mediaId: string): Promise<IMovieInfo> => {
    if (!mediaId.startsWith(this.baseUrl)) {
      mediaId = `${this.baseUrl}/${mediaId}`;
    }

    const movieInfo: IMovieInfo = {
      id: mediaId.split('to/').pop()!,
      title: '',
      url: mediaId,
    };

    try {
      const { data } = await this.client.get(mediaId);
      const $ = load(data);
      const recommendationsArray: IMovieResult[] = [];

      $(
        'div.movie_information > div.container > div.m_i-related > div.film-related > section.block_area > div.block_area-content > div.film_list-wrap > div.flw-item'
      ).each((i, el) => {
        recommendationsArray.push({
          id: $(el).find('div.film-poster > a').attr('href')?.slice(1)!,
          title: $(el).find('div.film-detail > h3.film-name > a').text(),
          image: $(el).find('div.film-poster > img').attr('data-src'),
          duration:
            $(el).find('div.film-detail > div.fd-infor > span.fdi-duration').text().replace('m', '') ?? null,
          type:
            $(el).find('div.film-detail > div.fd-infor > span.fdi-type').text().toLowerCase() === 'tv'
              ? TvType.TVSERIES
              : TvType.MOVIE ?? null,
        });
      });

      const uid = $('.watch_block').attr('data-id')!;
      movieInfo.cover = $('div.w_b-cover').attr('style')?.slice(22).replace(')', '').replace(';', '');
      movieInfo.title = $('.heading-name > a:nth-child(1)').text();
      movieInfo.image = $('.m_i-d-poster > div:nth-child(1) > img:nth-child(1)').attr('src');
      movieInfo.description = $('.description').text();
      movieInfo.type = movieInfo.id.split('/')[0] === 'tv' ? TvType.TVSERIES : TvType.MOVIE;
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
      movieInfo.recommendations = recommendationsArray as any;

      if (movieInfo.type === TvType.TVSERIES) {
        const { data } = await this.client.get(`${this.baseUrl}/ajax/v2/tv/seasons/${uid}`);
        const $$ = load(data);
        const seasonsIds = $$('.dropdown-menu > a')
          .map((i, el) => $(el).attr('data-id'))
          .get();

        movieInfo.episodes = [];
        let season = 1;
        for (const id of seasonsIds) {
          const { data } = await this.client.get(`${this.baseUrl}/ajax/v2/season/episodes/${id}`);
          const $$$ = load(data);

          $$$('.nav > li')
            .map((i, el) => {
              const episode = {
                id: $$$(el).find('a').attr('id')!.split('-')[1],
                title: $$$(el).find('a').attr('title')!,
                number: parseInt($$$(el).find('a').attr('title')!.split(':')[0].slice(3).trim()),
                season: season,
                url: `${this.baseUrl}/ajax/v2/episode/servers/${$$$(el).find('a').attr('id')!.split('-')[1]}`,
              };
              movieInfo.episodes?.push(episode);
            })
            .get();
          season++;
        }
      } else {
        movieInfo.episodes = [
          {
            id: uid,
            title: movieInfo.title,
            url: `${this.baseUrl}/ajax/movie/episodes/${uid}`,
          },
        ];
      }

      return movieInfo;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  /**
   * Fixed fetchEpisodeSources to properly handle watch pages
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
      // Get server list using the new AJAX endpoint
      const servers = await this.fetchEpisodeServers(episodeId, mediaId);
      const serverItem = servers.find(s => s.name.toLowerCase() === server.toLowerCase());
      
      if (!serverItem) {
        throw new Error(`Server ${server} not found`);
      }

      // Extract the server ID
      const serverId = serverItem.url.split('=').pop() || serverItem.url.split('/').pop();
      
      if (!serverId) {
        throw new Error('Server ID not found');
      }

      // Get the source URL
      const { data } = await this.client.get(
        `${this.baseUrl}/ajax/get_link/${serverId}`
      );

      if (!data.link) {
        throw new Error('No source found');
      }

      const serverUrl = new URL(data.link);
      return await this.fetchEpisodeSources(serverUrl.href, mediaId, server);
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  /**
   * Fixed fetchEpisodeServers to properly parse server lists
   */
  override fetchEpisodeServers = async (episodeId: string, mediaId: string): Promise<IEpisodeServer[]> => {
    try {
      // Use the new AJAX endpoint for getting the server list
      const { data } = await this.client.get(`${this.baseUrl}/ajax/episode/list/${episodeId}`);
      const $ = load(data);

      const servers: IEpisodeServer[] = $('.nav-item > a')
        .map((_, el) => {
          const $el = $(el);
          return {
            name: $el.text().toLowerCase().trim(),
            url: `${this.baseUrl}${$el.attr('data-linkid')}`,
          };
        })
        .get()
        .filter(server => server.url && server.name);

      // If no servers found, try alternate endpoint for series
      if (servers.length === 0 && !mediaId.includes('movie')) {
        const { data } = await this.client.get(`${this.baseUrl}/ajax/v2/episode/servers/${episodeId}`);
        const $$ = load(data);

        return $$('.nav-item > a')
          .map((_, el) => {
            const $el = $$(el);
            return {
              name: $el.text().toLowerCase().trim(),
              url: $el.attr('data-linkid') ?? '',
            };
          })
          .get()
          .filter(server => server.url && server.name);
      }

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
            type:
              $(el).find('div.film-detail > div.fd-infor > span.float-right').text() === 'Movie'
                ? TvType.MOVIE
                : TvType.TVSERIES,
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
            type:
              $(el).find('div.film-detail > div.fd-infor > span.float-right').text() === 'Movie'
                ? TvType.MOVIE
                : TvType.TVSERIES,
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
            type:
              $(el).find('div.film-detail > div.fd-infor > span.float-right').text() === 'Movie'
                ? TvType.MOVIE
                : TvType.TVSERIES,
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
            type:
              $(el).find('div.film-detail > div.fd-infor > span.float-right').text() === 'Movie'
                ? TvType.MOVIE
                : TvType.TVSERIES,
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
   * @param country country name/code
   * @param page page number (default 1)
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
   * @param genre genre name
   * @param page page number (default 1)
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
}

export default FlixHQ;
