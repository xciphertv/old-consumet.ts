import axios, { AxiosAdapter } from 'axios';
import {
  AnimeParser,
  ISearch,
  IAnimeInfo,
  MediaStatus,
  IAnimeResult,
  ISource,
  IAnimeEpisode,
  SubOrSub,
  IEpisodeServer,
  Genres,
  MangaParser,
  IMangaChapterPage,
  IMangaInfo,
  IMangaResult,
  IMangaChapter,
  ProxyConfig,
  MediaFormat,
  ITitle,
  IStaff,
} from '../../models';

import {
  anilistSearchQuery,
  anilistMediaDetailQuery,
  kitsuSearchQuery,
  anilistTrendingQuery,
  anilistPopularQuery,
  anilistAiringScheduleQuery,
  anilistGenresQuery,
  anilistAdvancedQuery,
  anilistSiteStatisticsQuery,
  anilistCharacterQuery,
  anilistStaffInfoQuery,
  range,
  getDays,
  days,
  capitalizeFirstLetter,
  isJson,
} from '../../utils';

import {
  getHashFromImage,
  ANIFY_URL,
  compareTwoStrings
} from '../../utils/utils';

// Provider imports
import Gogoanime from '../../providers/anime/gogoanime';
import Anify from '../anime/anify';
import Zoro from '../anime/zoro';
import Mangasee123 from '../manga/mangasee123';
import Crunchyroll from '../anime/crunchyroll';
import Bilibili from '../anime/bilibili';
import NineAnime from '../anime/9anime';

class Anilist extends AnimeParser {
  override readonly name = 'Anilist';
  protected override baseUrl = 'https://anilist.co';
  protected override logo = 'https://upload.wikimedia.org/wikipedia/commons/6/61/AniList_logo.svg';
  protected override classPath = 'META.Anilist';

  private readonly anilistGraphqlUrl = 'https://graphql.anilist.co';
  private readonly kitsuGraphqlUrl = 'https://kitsu.io/api/graphql';
  private readonly malSyncUrl = 'https://api.malsync.moe';
  private readonly anifyUrl = ANIFY_URL;
  
  provider: AnimeParser;

  constructor(
    provider?: AnimeParser,
    public proxyConfig?: ProxyConfig,
    adapter?: AxiosAdapter,
    customBaseURL?: string
  ) {
    super(proxyConfig, adapter);
    this.provider = provider || new Gogoanime(customBaseURL, proxyConfig);
  }

  /**
   * Enhanced search with better error handling and result processing
   */
  override async search(
    query: string,
    page: number = 1,
    perPage: number = 15
  ): Promise<ISearch<IAnimeResult>> {
    try {
      const options = {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        query: anilistSearchQuery(query, page, perPage),
      };

      const { data, status } = await this.client.post(this.anilistGraphqlUrl, options, {
        validateStatus: () => true,
      });

      // Fallback to Anify if Anilist is having issues
      if (status >= 500 || status === 429) {
        return await new Anify().rawSearch(query, page);
      }

      return this.processSearchResults(data);
    } catch (err) {
      throw new Error(`Search failed: ${(err as Error).message}`);
    }
  }

  /**
   * Improved episode fetching with enhanced error recovery
   */
  override async fetchAnimeInfo(
    id: string,
    dub: boolean = false,
    fetchFiller: boolean = false
  ): Promise<IAnimeInfo> {
    try {
      const animeInfo = await this.fetchAnilistInfo(id);
      const episodes = await this.fetchEpisodeList(animeInfo, dub, fetchFiller);
      
      return {
        ...animeInfo,
        episodes: episodes,
      };
    } catch (err) {
      throw new Error(`Failed to fetch anime info: ${(err as Error).message}`);
    }
  }

  /**
   * Enhanced episode source fetching
   */
  override async fetchEpisodeSources(
    episodeId: string,
    ...args: any
  ): Promise<ISource> {
    if (!episodeId) {
      throw new Error('Episode ID is required');
    }

    try {
      if (this.provider instanceof Anify) {
        return await this.provider.fetchEpisodeSources(episodeId, args[0], args[1]);
      }
      return await this.provider.fetchEpisodeSources(episodeId, ...args);
    } catch (err) {
      throw new Error(`Failed to fetch episode sources: ${(err as Error).message}`);
    }
  }

  /**
   * Improved episode server fetching
   */
  override async fetchEpisodeServers(episodeId: string): Promise<IEpisodeServer[]> {
    if (!episodeId) {
      throw new Error('Episode ID is required');
    }

    try {
      return await this.provider.fetchEpisodeServers(episodeId);
    } catch (err) {
      throw new Error(`Failed to fetch episode servers: ${(err as Error).message}`);
    }
  }

  /**
   * Core helper methods
   */
  private async fetchAnilistInfo(id: string): Promise<IAnimeInfo> {
    const options = {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      query: anilistMediaDetailQuery(id),
    };

    const { data } = await this.client.post(this.anilistGraphqlUrl, options);
    return this.processAnilistData(data.data.Media);
  }

  private async fetchEpisodeList(
    animeInfo: IAnimeInfo,
    dub: boolean,
    fetchFiller: boolean
  ): Promise<IAnimeEpisode[]> {
    let episodes: IAnimeEpisode[] = [];

    // Try Anify first for newer anime
    if (this.shouldUseAnify(animeInfo)) {
      try {
        episodes = await this.fetchAnifyEpisodes(animeInfo.id, dub);
      } catch (err) {
        console.error('Anify fetch failed, falling back to default:', err);
      }
    }

    // Fallback to default provider if needed
    if (!episodes.length) {
      episodes = await this.fetchDefaultEpisodes(animeInfo, dub);
    }

    // Add filler information if requested
    if (fetchFiller && animeInfo.malId) {
      episodes = await this.addFillerInfo(episodes, animeInfo.malId);
    }

    return this.processEpisodeList(episodes, animeInfo);
  }

  private shouldUseAnify(animeInfo: IAnimeInfo): boolean {
    return (
      (this.provider instanceof Zoro || this.provider instanceof Gogoanime) &&
      (animeInfo.status === MediaStatus.ONGOING ||
        range({ from: 2000, to: new Date().getFullYear() + 1 }).includes(
          parseInt(animeInfo.releaseDate!)
        ))
    );
  }

  private async fetchAnifyEpisodes(
    id: string,
    dub: boolean
  ): Promise<IAnimeEpisode[]> {
    const anifyInfo = await new Anify(
      this.proxyConfig,
      this.adapter,
      this.provider.name.toLowerCase() as 'gogoanime' | 'zoro'
    ).fetchAnimeInfo(id);

    return anifyInfo.episodes?.map(episode => ({
      id: episode.id,
      title: episode.title,
      description: episode.description,
      number: episode.number,
      image: episode.image,
      imageHash: getHashFromImage(episode.image),
    })) || [];
  }

  private async fetchDefaultEpisodes(
    animeInfo: IAnimeInfo,
    dub: boolean
  ): Promise<IAnimeEpisode[]> {
    const mediaInfo = {
      idMal: animeInfo.malId as number,
      season: animeInfo.season!,
      startDate: { year: parseInt(animeInfo.releaseDate!) },
      title: {
        english: animeInfo.title?.english!,
        romaji: animeInfo.title?.romaji!,
      },
    };

    return await this.findAnime(
      mediaInfo.title,
      mediaInfo.season,
      mediaInfo.startDate.year,
      mediaInfo.idMal,
      dub,
      animeInfo.id
    );
  }

  private async addFillerInfo(
    episodes: IAnimeEpisode[],
    malId: number
  ): Promise<IAnimeEpisode[]> {
    try {
      const { data: fillerData } = await this.client.get(
        `https://raw.githubusercontent.com/saikou-app/mal-id-filler-list/main/fillers/${malId}.json`
      );

      if (fillerData.episodes) {
        return episodes.map((episode, index) => ({
          ...episode,
          isFiller: Boolean(fillerData.episodes[index]?.['filler-bool']),
        }));
      }
    } catch (err) {
      console.error('Failed to fetch filler info:', err);
    }

    return episodes;
  }

  private processEpisodeList(
    episodes: IAnimeEpisode[],
    animeInfo: IAnimeInfo
  ): IAnimeEpisode[] {
    return episodes.map(episode => ({
      ...episode,
      image: episode.image || animeInfo.image,
      imageHash: episode.imageHash || animeInfo.imageHash,
    }));
  }

  /**
   * Helper method for finding anime across providers
   */
  private async findAnime(
    title: { romaji: string; english: string },
    season: string,
    startDate: number,
    malId: number,
    dub: boolean,
    anilistId: string
  ): Promise<IAnimeEpisode[]> {
    // Normalize titles
    const normalizedTitle = {
      english: (title.english || title.romaji).toLowerCase(),
      romaji: (title.romaji || title.english).toLowerCase(),
    };

    // Try romaji title first
    let episodes = await this.findAnimeByTitle(
      normalizedTitle.romaji,
      season,
      startDate,
      malId,
      dub,
      anilistId
    );

    // Fall back to english title if needed
    if (!episodes.length && normalizedTitle.english !== normalizedTitle.romaji) {
      episodes = await this.findAnimeByTitle(
        normalizedTitle.english,
        season,
        startDate,
        malId,
        dub,
        anilistId
      );
    }

    return episodes;
  }

  private async findAnimeByTitle(
    title: string,
    season: string,
    startDate: number,
    malId: number,
    dub: boolean,
    anilistId: string
  ): Promise<IAnimeEpisode[]> {
    const slug = title.replace(/[^0-9a-zA-Z]+/g, ' ');
    
    let possibleAnime = await this.findAnimeInMalSync(slug, malId, dub);
    
    if (!possibleAnime) {
      possibleAnime = await this.findAnimeBySearch(slug);
    }

    if (!possibleAnime?.episodes?.length) {
      return [];
    }

    return this.processProviderEpisodes(possibleAnime, dub);
  }

  private async findAnimeInMalSync(
    slug: string,
    malId: number,
    dub: boolean
  ): Promise<any> {
    if (!malId || this.provider instanceof Crunchyroll || this.provider instanceof Bilibili) {
      return null;
    }

    try {
      const { data } = await this.client.get(`${this.malSyncUrl}/mal/anime/${malId}`);
      const sites = this.processMalSyncSites(data, slug);
      const matchingSite = this.findMatchingProvider(sites, dub);

      if (matchingSite) {
        return await this.provider.fetchAnimeInfo(matchingSite.url.split('/').pop()!);
      }
    } catch (err) {
      console.error('MAL Sync lookup failed:', err);
    }

    return null;
  }

  private processMalSyncSites(data: any, targetTitle: string): any[] {
    const sites = [];
    for (const siteGroup of Object.values(data.Sites)) {
      for (const site of Object.values(siteGroup as object)) {
        const { page, url, title } = site as { page: string; url: string; title: string };
        const similarity = compareTwoStrings(targetTitle.toLowerCase(), title.toLowerCase());
        sites.push({ page, url, title, similarity });
      }
    }
    return sites.sort((a, b) => b.similarity - a.similarity);
  }

  private findMatchingProvider(sites: any[], dub: boolean): any {
    return sites.find(site => {
      if (site.page.toLowerCase() !== this.provider.name.toLowerCase()) {
        return false;
      }
      if (this.provider instanceof Gogoanime) {
        return dub ? site.title.toLowerCase().includes('dub') : !site.title.toLowerCase().includes('dub');
      }
      return true;
    });
  }

  private async findAnimeBySearch(slug: string): Promise<any> {
    const searchResults = await this.provider.search(slug);
    if (!searchResults.results.length) {
      return null;
    }

    // Find best match
    const bestMatch = searchResults.results.reduce((prev, current) => {
      const prevTitle = typeof prev.title === 'string' ? prev.title : prev.title.english || prev.title.romaji;
      const currentTitle = typeof current.title === 'string' ? current.title : current.title.english || current.title.romaji;
      
      const prevSimilarity = compareTwoStrings(slug.toLowerCase(), prevTitle.toLowerCase());
      const currentSimilarity = compareTwoStrings(slug.toLowerCase(), currentTitle.toLowerCase());

      return currentSimilarity > prevSimilarity ? current : prev;
    });

    if (bestMatch) {
      return await this.provider.fetchAnimeInfo(bestMatch.id);
    }

    return null;
  }

  private processProviderEpisodes(possibleAnime: any, dub: boolean): IAnimeEpisode[] {
    // Handle provider-specific episode processing
    if (this.provider instanceof Zoro) {
      return this.processZoroEpisodes(possibleAnime, dub);
    }
    if (this.provider instanceof NineAnime) {
      return this.processNineAnimeEpisodes(possibleAnime, dub);
    }
    if (this.provider instanceof Crunchyroll) {
      return this.processCrunchyrollEpisodes(possibleAnime, dub);
    }

    // Default episode processing
    return this.processDefaultEpisodes(possibleAnime, dub);
  }

  private processZoroEpisodes(possibleAnime: any, dub: boolean): IAnimeEpisode[] {
        return possibleAnime.episodes.map((episode: any) => ({
          ...episode,
          id: possibleAnime.subOrDub === SubOrSub.BOTH
            ? episode.id.replace('$both', dub ? '$dub' : '$sub')
            : episode.id
        }));
      }

      private processNineAnimeEpisodes(possibleAnime: any, dub: boolean): IAnimeEpisode[] {
        return possibleAnime.episodes
          .map((episode: any) => ({
            ...episode,
            id: dub ? episode.dubId : episode.id
          }))
          .filter((episode: any) => episode.id != null);
      }

      private processCrunchyrollEpisodes(possibleAnime: any, dub: boolean): IAnimeEpisode[] {
        const episodes = Object.keys(possibleAnime.episodes)
          .filter((key: string) => key.toLowerCase().includes(dub ? 'dub' : 'sub'))
          .sort((first: string, second: string) => {
            return (
              (possibleAnime.episodes[first]?.[0].season_number ?? 0) -
              (possibleAnime.episodes[second]?.[0].season_number ?? 0)
            );
          })
          .map((key: string) => {
            const audio = key
              .replace(/[0-9]/g, '')
              .replace(/(^\w{1})|(\s+\w{1})/g, (letter: string) => letter.toUpperCase());
            return possibleAnime.episodes[key].map((episode: any) => ({
              ...episode,
              type: audio
            }));
          });
        return episodes.flat();
      }

      private processDefaultEpisodes(possibleAnime: any, dub: boolean): IAnimeEpisode[] {
        const expectedType = dub ? SubOrSub.DUB : SubOrSub.SUB;

        if (possibleAnime.subOrDub && 
            possibleAnime.subOrDub !== SubOrSub.BOTH && 
            possibleAnime.subOrDub !== expectedType) {
          return [];
        }

        return possibleAnime.episodes || [];
      }

      /**
       * Advanced search functionality
       */
      async advancedSearch(
        query?: string,
        type: string = 'ANIME',
        page: number = 1,
        perPage: number = 20,
        format?: string,
        sort?: string[],
        genres?: Genres[] | string[],
        id?: string | number,
        year?: number,
        status?: string,
        season?: string
      ): Promise<ISearch<IAnimeResult>> {
        try {
          // Validate genres if provided
          if (genres?.length) {
            genres.forEach(genre => {
              if (!Object.values(Genres).includes(genre as Genres)) {
                throw new Error(`Invalid genre: ${genre}`);
              }
            });
          }

          const options = {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            query: anilistAdvancedQuery(),
            variables: {
              search: query,
              type: type,
              page: page,
              size: perPage,
              format: format,
              sort: sort,
              genres: genres,
              id: id,
              year: year ? `${year}%` : undefined,
              status: status,
              season: season,
            },
          };

          const { data, status } = await this.client.post(this.anilistGraphqlUrl, options, {
            validateStatus: () => true,
          });

          if (status >= 500 && !query) throw new Error('No results found');
          if (status >= 500) return await new Anify().rawSearch(query!, page);

          return this.processAdvancedSearchResults(data);
        } catch (err) {
          throw new Error(`Advanced search failed: ${(err as Error).message}`);
        }
      }

      private processAdvancedSearchResults(data: any): ISearch<IAnimeResult> {
        return {
          currentPage: data.data?.Page?.pageInfo?.currentPage ?? data.meta?.currentPage,
          hasNextPage: data.data?.Page?.pageInfo?.hasNextPage ?? data.meta?.currentPage != data.meta?.lastPage,
          totalPages: data.data?.Page?.pageInfo?.lastPage,
          totalResults: data.data?.Page?.pageInfo?.total,
          results: this.mapSearchResults(data.data?.Page?.media || [])
        };
      }

      private mapSearchResults(mediaItems: any[]): IAnimeResult[] {
        return mediaItems.map(item => ({
          id: item.id.toString(),
          malId: item.idMal,
          title: {
            romaji: item.title?.romaji,
            english: item.title?.english,
            native: item.title?.native,
            userPreferred: item.title?.userPreferred,
          },
          status: this.parseMediaStatus(item.status),
          image: item.coverImage?.extraLarge || item.coverImage?.large || item.coverImage?.medium,
          imageHash: getHashFromImage(item.coverImage?.extraLarge || item.coverImage?.large || item.coverImage?.medium),
          cover: item.bannerImage,
          coverHash: getHashFromImage(item.bannerImage),
          popularity: item.popularity,
          description: item.description,
          rating: item.averageScore,
          genres: item.genres,
          color: item.coverImage?.color,
          totalEpisodes: item.episodes || item.nextAiringEpisode?.episode - 1,
          currentEpisode: item?.nextAiringEpisode?.episode - 1 || item.episodes,
          type: item.format,
          releaseDate: item.seasonYear,
        }));
      }

      private parseMediaStatus(status: string): MediaStatus {
        switch (status) {
          case 'RELEASING':
            return MediaStatus.ONGOING;
          case 'FINISHED':
            return MediaStatus.COMPLETED;
          case 'NOT_YET_RELEASED':
            return MediaStatus.NOT_YET_AIRED;
          case 'CANCELLED':
            return MediaStatus.CANCELLED;
          case 'HIATUS':
            return MediaStatus.HIATUS;
          default:
            return MediaStatus.UNKNOWN;
        }
      }

      /**
       * Trending and Popular anime methods
       */
      async fetchTrendingAnime(
        page: number = 1,
        perPage: number = 10
      ): Promise<ISearch<IAnimeResult>> {
        try {
          const { data } = await this.client.post(this.anilistGraphqlUrl, {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            query: anilistTrendingQuery(page, perPage),
          });

          return {
            currentPage: data.data.Page.pageInfo.currentPage,
            hasNextPage: data.data.Page.pageInfo.hasNextPage,
            results: this.mapSearchResults(data.data.Page.media),
          };
        } catch (err) {
          throw new Error(`Failed to fetch trending anime: ${(err as Error).message}`);
        }
      }

      async fetchPopularAnime(
        page: number = 1,
        perPage: number = 10
      ): Promise<ISearch<IAnimeResult>> {
        try {
          const { data } = await this.client.post(this.anilistGraphqlUrl, {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            query: anilistPopularQuery(page, perPage),
          });

          return {
            currentPage: data.data.Page.pageInfo.currentPage,
            hasNextPage: data.data.Page.pageInfo.hasNextPage,
            results: this.mapSearchResults(data.data.Page.media),
          };
        } catch (err) {
          throw new Error(`Failed to fetch popular anime: ${(err as Error).message}`);
        }
      }

      /**
       * Recent episodes fetch method
       */
      async fetchRecentEpisodes(
        provider: 'gogoanime' | 'zoro' = 'gogoanime',
        page: number = 1,
        perPage: number = 25
      ): Promise<ISearch<IAnimeResult>> {
        try {
          const { data } = await this.client.get(
            `${this.anifyUrl}/recent?page=${page}&perPage=${perPage}&type=anime`
          );

          return {
            currentPage: page,
            totalResults: data?.length,
            results: this.mapRecentEpisodes(data, provider),
          };
        } catch (err) {
          throw new Error(`Failed to fetch recent episodes: ${(err as Error).message}`);
        }
      }

      private mapRecentEpisodes(data: any[], provider: string): IAnimeResult[] {
        return data?.map(item => ({
          id: item.id.toString(),
          malId: item.mappings?.find(
            (mapping: any) => mapping.providerType === 'META' && mapping.providerId === 'mal'
          )?.id,
          title: {
            romaji: item.title?.romaji,
            english: item.title?.english,
            native: item.title?.native,
          },
          image: item.coverImage ?? item.bannerImage,
          imageHash: getHashFromImage(item.coverImage ?? item.bannerImage),
          rating: item.averageScore,
          color: item.anime?.color,
          episodeId: this.getEpisodeId(item, provider),
          episodeTitle: item.episodes.latest.latestTitle ?? `Episode ${item.currentEpisode}`,
          episodeNumber: item.currentEpisode,
          genres: item.genre,
          type: item.format,
        }));
      }

      private getEpisodeId(item: any, provider: string): string {
        const episodes = item.episodes.data;
        const providerEpisodes = episodes.find(
          (source: any) => source.providerId.toLowerCase() === provider
        )?.episodes;
        
        return providerEpisodes?.pop()?.id ?? '';
      }
}

export default Anilist;
